import mongoose from 'mongoose';
import { isRestaurantOnboardingPaymentEnabled } from '../../admin/services/moduleAccess.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodOnboardingPayment } from '../models/onboardingPayment.model.js';
import {
    buildOnboardingQuote,
    reserveOfferSlot,
    redeemOfferSlot,
    releaseOfferSlot
} from './onboardingPricing.service.js';
import { getRestaurantTypeLabel, isValidRestaurantType } from '../../shared/restaurantTypes.js';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature,
    fetchRazorpayPayment,
    assertRazorpayPaymentMatches,
    findSuccessfulPaymentForOrder
} from '../../orders/helpers/razorpay.helper.js';

/** How long a checkout may hold an offer slot before a later request may reclaim it. */
const RESERVATION_TTL_MS = 20 * 60 * 1000;

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/**
 * Loads the restaurant that a payment belongs to. Type and zone are read from here
 * and nowhere else, so a tampered request body cannot influence pricing.
 */
const loadOnboardingRestaurant = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName ownerName ownerEmail ownerPhone restaurantType zoneId status onboardingPayment')
        .lean();
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    return restaurant;
};

/**
 * Refuses to start a new onboarding charge while the admin toggle is off.
 *
 * Hiding the checkout in the UI is not enough: without this, a stale client or a
 * hand-made request could still mint a Razorpay order for a fee the platform is
 * no longer collecting. Verification is deliberately NOT gated — if a restaurant
 * already paid while the toggle was on, that payment must still be confirmable
 * so the money is never taken without being credited.
 */
const assertOnboardingPaymentEnabled = async () => {
    const enabled = await isRestaurantOnboardingPaymentEnabled();
    if (!enabled) {
        throw new ValidationError('Onboarding payment is not required at the moment');
    }
};

const assertPayable = (restaurant) => {
    if (restaurant.status === 'approved' || restaurant.status === 'pending' || restaurant.status === 'rejected') {
        throw new ValidationError('This restaurant has already been submitted for approval');
    }
    if (restaurant.status === 'banned' || restaurant.status === 'deleted') {
        throw new ValidationError('This restaurant account is not active');
    }
    if (!restaurant.restaurantType) {
        throw new ValidationError('Restaurant type is missing. Please complete onboarding again.');
    }
    if (!restaurant.zoneId) {
        throw new ValidationError('Service zone is missing. Please complete onboarding again.');
    }
};

/**
 * Same rule registration applies: a fee is due only while onboarding payment is on and
 * an active admin pricing rule (zone or all-zones) prices this restaurant above zero.
 */
const isOnboardingFeeDue = async (restaurant) => {
    if (!(await isRestaurantOnboardingPaymentEnabled())) return false;
    if (!isValidRestaurantType(restaurant.restaurantType) || !restaurant.zoneId) return false;
    const quote = await buildOnboardingQuote({
        zoneId: restaurant.zoneId,
        restaurantType: restaurant.restaurantType
    });
    return quote.feeRequired;
};

/**
 * A restaurant waits in `payment_pending` only while a fee is actually due. When the
 * admin has since switched onboarding payment off, or removed/disabled the pricing rule
 * that covered its zone and type, sending it to a checkout would be a dead end, so it
 * moves into the approval queue. It lands on `pending` — admin approval is as required
 * as ever — and existing payment rows are left untouched, so a payment already in
 * flight can still be verified and credited.
 *
 * @returns {Promise<boolean>} true when no fee is due and the restaurant was released
 */
export const releaseIfNoOnboardingFeeDue = async (restaurantId) => {
    const restaurant = await loadOnboardingRestaurant(restaurantId);
    if (restaurant.status !== 'payment_pending') return false;
    if (await isOnboardingFeeDue(restaurant)) return false;

    await FoodRestaurant.updateOne(
        { _id: restaurant._id, status: 'payment_pending' },
        {
            $set: {
                status: 'pending',
                'onboardingPayment.status': 'not_required',
                submittedForApprovalAt: new Date()
            }
        }
    );
    logger.info(`[ONBOARD-PAY] No onboarding fee due for ${restaurant._id}; moved to the approval queue`);
    return true;
};

/** Response for a restaurant that turned out to owe nothing: it is already submitted. */
const noFeeDueResponse = () => ({
    alreadyPaid: false,
    submitted: true,
    feeRequired: false,
    payment: null,
    quote: null
});

/**
 * Release the offer slot held by a stale, never-completed checkout so a later
 * restaurant is not blocked by an abandoned one.
 */
const sweepExpiredReservation = async (payment) => {
    if (!payment?.offerSlotHeld) return;
    if (payment.status !== 'created') return;
    if (!payment.reservationExpiresAt || payment.reservationExpiresAt > new Date()) return;

    const claimed = await FoodOnboardingPayment.findOneAndUpdate(
        { _id: payment._id, status: 'created', offerSlotHeld: true },
        { $set: { offerSlotHeld: false, status: 'cancelled', failureReason: 'Checkout expired' } },
        { new: true }
    ).lean();

    if (claimed?.pricing?.offerId) {
        await releaseOfferSlot(claimed.pricing.offerId);
        logger.info(`[ONBOARD-PAY] Released expired offer slot for payment ${claimed._id}`);
    }
};

/**
 * Reclaim offer slots from checkouts that were opened and never finished by anyone.
 *
 * Without this an abandoned checkout would hold its slot until that same restaurant
 * came back, so run it before any availability is evaluated. Each release is a
 * conditional update, so two concurrent sweeps cannot double-release one slot.
 */
const releaseAbandonedReservations = async () => {
    const stale = await FoodOnboardingPayment.find({
        status: 'created',
        offerSlotHeld: true,
        reservationExpiresAt: { $lt: new Date() }
    })
        .select('_id pricing.offerId')
        .limit(50)
        .lean();

    for (const record of stale) {
        const claimed = await FoodOnboardingPayment.findOneAndUpdate(
            { _id: record._id, status: 'created', offerSlotHeld: true },
            { $set: { status: 'cancelled', offerSlotHeld: false, failureReason: 'Checkout abandoned' } },
            { new: true }
        ).lean();
        if (claimed?.pricing?.offerId) {
            await releaseOfferSlot(claimed.pricing.offerId);
            logger.info(`[ONBOARD-PAY] Reclaimed abandoned offer slot from payment ${claimed._id}`);
        }
    }
};

/**
 * Ask Razorpay whether an order was actually paid.
 *
 * The browser is not a reliable witness: the shared checkout helper fires onClose
 * 1.5s after the tab regains visibility, so a UPI app hop or a tab switch looks
 * exactly like a cancellation while the payment is still completing. Anything that
 * would discard a payment must confirm with the gateway first.
 *
 * @returns {Promise<object|null>} the captured/authorized payment, or null
 */
const findGatewayPaymentForOrder = async (razorpayOrderId) => {
    if (!razorpayOrderId || !isRazorpayConfigured()) return null;
    try {
        return await findSuccessfulPaymentForOrder(razorpayOrderId);
    } catch (error) {
        // A lookup failure must not silently cancel a possibly-successful payment.
        logger.error(
            `[ONBOARD-PAY] Gateway lookup failed for order ${razorpayOrderId}: ${error?.message || error}`
        );
        throw error;
    }
};

/**
 * Re-take an offer slot for a payment whose reservation was released before the
 * payment turned out to be genuine. If the offer has since filled up we still honour
 * the price the customer was charged — taking the money and denying the discount
 * would be worse than briefly exceeding the cap by one.
 */
const reclaimOfferSlotForRecovery = async (payment) => {
    const offerId = payment?.pricing?.offerId;
    if (!offerId) return;
    const reserved = await reserveOfferSlot(offerId);
    if (!reserved) {
        logger.warn(
            `[ONBOARD-PAY] Offer ${offerId} was full when recovering payment ${payment._id}; ` +
            'honouring the charged offer price anyway'
        );
    }
};

/** Public shape of a payment record (safe for the partner app and admin UI). */
export const toOnboardingPaymentView = (payment) => {
    if (!payment) return null;
    return {
        id: String(payment._id),
        restaurantId: String(payment.restaurantId),
        status: payment.status,
        restaurantType: payment.restaurantType,
        restaurantTypeLabel:
            payment.pricing?.restaurantTypeLabel || getRestaurantTypeLabel(payment.restaurantType),
        zoneId: payment.zoneId ? String(payment.zoneId) : null,
        zoneName: payment.pricing?.zoneName || '',
        currency: payment.pricing?.currency || 'INR',
        originalPrice: payment.pricing?.originalPrice ?? null,
        offerPrice: payment.pricing?.offerPrice ?? null,
        finalAmount: payment.pricing?.finalAmount ?? null,
        offerApplied: Boolean(payment.pricing?.offerId),
        offerName: payment.pricing?.offerName || '',
        priceSource: payment.pricing?.priceSource || '',
        transactionReference: payment.gateway?.razorpayPaymentId || '',
        gatewayOrderId: payment.gateway?.razorpayOrderId || '',
        paidAt: payment.paidAt || null,
        failureReason: payment.failureReason || '',
        createdAt: payment.createdAt
    };
};

/**
 * Live quote for the onboarding payment screen. Read-only: showing a quote never
 * reserves a slot, so opening the page does not consume an offer.
 */
export const getOnboardingPaymentQuote = async (restaurantId) => {
    const restaurant = await loadOnboardingRestaurant(restaurantId);

    const paid = await FoodOnboardingPayment.findOne({
        restaurantId: restaurant._id,
        status: 'paid'
    }).lean();

    if (paid) {
        return {
            alreadyPaid: true,
            submitted: restaurant.status !== 'payment_pending',
            payment: toOnboardingPaymentView(paid),
            quote: null
        };
    }

    if (await releaseIfNoOnboardingFeeDue(restaurant._id)) return noFeeDueResponse();

    // Nothing to quote while onboarding payment is switched off.
    await assertOnboardingPaymentEnabled();
    assertPayable(restaurant);

    const pending = await FoodOnboardingPayment.findOne({
        restaurantId: restaurant._id,
        status: 'created'
    })
        .sort({ createdAt: -1 })
        .lean();
    await sweepExpiredReservation(pending);
    await releaseAbandonedReservations();

    const quote = await buildOnboardingQuote({
        zoneId: restaurant.zoneId,
        restaurantType: restaurant.restaurantType
    });

    return {
        alreadyPaid: false,
        submitted: false,
        payment: null,
        restaurant: {
            id: String(restaurant._id),
            restaurantName: restaurant.restaurantName,
            ownerName: restaurant.ownerName,
            ownerEmail: restaurant.ownerEmail || '',
            ownerPhone: restaurant.ownerPhone || ''
        },
        gatewayConfigured: isRazorpayConfigured(),
        quote
    };
};

/**
 * Create (or reuse) the gateway order for this restaurant's onboarding fee.
 *
 * The amount is recomputed here from persisted zone + type; the client sends nothing
 * that influences it. An offer slot is reserved atomically at this point and the
 * resulting price is snapshotted onto the payment record.
 */
export const createOnboardingPaymentOrder = async (restaurantId) => {
    const restaurant = await loadOnboardingRestaurant(restaurantId);

    const alreadyPaid = await FoodOnboardingPayment.findOne({
        restaurantId: restaurant._id,
        status: 'paid'
    }).lean();
    if (alreadyPaid) {
        return { alreadyPaid: true, payment: toOnboardingPaymentView(alreadyPaid) };
    }

    if (await releaseIfNoOnboardingFeeDue(restaurant._id)) return noFeeDueResponse();

    // No new Razorpay order may be created while onboarding payment is off.
    await assertOnboardingPaymentEnabled();
    assertPayable(restaurant);

    // Reuse a live order instead of minting a new one on every click — this makes
    // repeated "Pay" presses idempotent and avoids stacking offer reservations.
    const existing = await FoodOnboardingPayment.findOne({
        restaurantId: restaurant._id,
        status: 'created'
    })
        .sort({ createdAt: -1 })
        .lean();

    if (existing) {
        if (!existing.reservationExpiresAt || existing.reservationExpiresAt > new Date()) {
            return {
                alreadyPaid: false,
                reused: true,
                payment: toOnboardingPaymentView(existing),
                razorpay: {
                    key: getRazorpayKeyId(),
                    orderId: existing.gateway?.razorpayOrderId || '',
                    amount: existing.amountPaise,
                    currency: existing.pricing?.currency || 'INR'
                }
            };
        }
        await sweepExpiredReservation(existing);
    }

    // Reclaim any slot held by an abandoned checkout before pricing this one.
    await releaseAbandonedReservations();

    const quote = await buildOnboardingQuote({
        zoneId: restaurant.zoneId,
        restaurantType: restaurant.restaurantType
    });

    // Take the offer slot before pricing is frozen. If the slot was claimed by a
    // concurrent checkout in the meantime, silently fall back to the base price.
    let appliedOffer = null;
    if (quote.offer?.id) {
        const reserved = await reserveOfferSlot(quote.offer.id);
        if (reserved) {
            appliedOffer = reserved;
        } else {
            logger.info(
                `[ONBOARD-PAY] Offer ${quote.offer.id} exhausted before restaurant ${restaurant._id} could reserve it`
            );
        }
    }

    const finalAmount = appliedOffer ? quote.offerPrice : quote.originalPrice;
    const amountPaise = toPaise(finalAmount);

    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
        if (appliedOffer) await releaseOfferSlot(appliedOffer._id);
        throw new ValidationError('Onboarding fee is not configured for this zone and restaurant type');
    }

    const pricing = {
        originalPrice: quote.originalPrice,
        offerPrice: appliedOffer ? quote.offerPrice : null,
        finalAmount,
        currency: quote.currency,
        priceSource: quote.priceSource,
        pricingRuleId: quote.pricingRuleId || null,
        offerId: appliedOffer?._id || null,
        offerName: appliedOffer?.name || '',
        zoneName: quote.zoneName,
        restaurantTypeLabel: quote.restaurantTypeLabel
    };

    let razorpayOrder = null;
    if (isRazorpayConfigured()) {
        try {
            razorpayOrder = await createRazorpayOrder(
                amountPaise,
                quote.currency || 'INR',
                `onb_${String(restaurant._id).slice(-10)}_${Date.now()}`.slice(0, 40)
            );
        } catch (error) {
            if (appliedOffer) await releaseOfferSlot(appliedOffer._id);
            logger.error(`[ONBOARD-PAY] Razorpay order failed for ${restaurant._id}: ${error?.message || error}`);
            throw new ValidationError('Could not start the payment. Please try again.');
        }
    } else if (config.nodeEnv === 'production') {
        if (appliedOffer) await releaseOfferSlot(appliedOffer._id);
        throw new ValidationError('Payment gateway is not configured');
    }

    let payment;
    try {
        payment = await FoodOnboardingPayment.create({
            restaurantId: restaurant._id,
            zoneId: restaurant.zoneId,
            restaurantType: restaurant.restaurantType,
            ownerPhone: restaurant.ownerPhone || '',
            pricing,
            amountPaise,
            status: 'created',
            gateway: {
                provider: 'razorpay',
                razorpayOrderId: razorpayOrder ? String(razorpayOrder.id) : `order_dev_${Date.now()}`
            },
            offerSlotHeld: Boolean(appliedOffer),
            reservationExpiresAt: new Date(Date.now() + RESERVATION_TTL_MS)
        });
    } catch (error) {
        if (appliedOffer) await releaseOfferSlot(appliedOffer._id);
        throw error;
    }

    return {
        alreadyPaid: false,
        reused: false,
        payment: toOnboardingPaymentView(payment.toObject()),
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: payment.gateway.razorpayOrderId,
            amount: amountPaise,
            currency: quote.currency || 'INR'
        }
    };
};

/**
 * The one place a payment becomes "paid" and the restaurant enters the admin queue.
 *
 * Idempotent by construction: the `created -> paid` transition is a conditional
 * findOneAndUpdate, so a duplicate webhook or a replayed verify call finds nothing to
 * update and returns the existing record without redeeming a second offer slot or
 * re-submitting the restaurant.
 */
export const finalizeOnboardingPayment = async ({
    payment,
    razorpayPaymentId,
    signatureVerified = false,
    confirmedVia = 'checkout_verify'
}) => {
    if (!payment) throw new NotFoundError('Onboarding payment not found');

    if (payment.status === 'paid') {
        const current = await FoodOnboardingPayment.findById(payment._id).lean();
        return { payment: current, alreadyProcessed: true };
    }

    const paidAt = new Date();
    const claimed = await FoodOnboardingPayment.findOneAndUpdate(
        { _id: payment._id, status: { $ne: 'paid' } },
        {
            $set: {
                status: 'paid',
                paidAt,
                failureReason: '',
                'gateway.razorpayPaymentId': String(razorpayPaymentId || ''),
                'gateway.signatureVerified': Boolean(signatureVerified),
                'gateway.confirmedVia': confirmedVia,
                offerSlotHeld: false,
                reservationExpiresAt: null
            }
        },
        { new: true }
    ).lean();

    if (!claimed) {
        const current = await FoodOnboardingPayment.findById(payment._id).lean();
        return { payment: current, alreadyProcessed: true };
    }

    // Promote the reservation to a confirmed redemption exactly once.
    if (claimed.pricing?.offerId && !claimed.offerSlotRedeemed) {
        const marked = await FoodOnboardingPayment.findOneAndUpdate(
            { _id: claimed._id, offerSlotRedeemed: false },
            { $set: { offerSlotRedeemed: true } },
            { new: true }
        ).lean();
        if (marked) await redeemOfferSlot(claimed.pricing.offerId);
    }

    await submitRestaurantForApproval(claimed);

    return { payment: claimed, alreadyProcessed: false };
};

/**
 * Moves the restaurant out of `payment_pending` into the existing admin approval
 * queue. Guarded on the current status so repeated calls cannot re-submit a
 * restaurant an admin has already actioned.
 */
const submitRestaurantForApproval = async (payment) => {
    const updated = await FoodRestaurant.findOneAndUpdate(
        { _id: payment.restaurantId, status: 'payment_pending' },
        {
            $set: {
                status: 'pending',
                pendingApprovalType: 'registration',
                submittedForApprovalAt: new Date(),
                onboardingPayment: {
                    status: 'paid',
                    paymentId: payment._id,
                    amountPaid: payment.pricing?.finalAmount ?? null,
                    originalPrice: payment.pricing?.originalPrice ?? null,
                    offerPrice: payment.pricing?.offerPrice ?? null,
                    offerName: payment.pricing?.offerName || '',
                    currency: payment.pricing?.currency || 'INR',
                    transactionReference: payment.gateway?.razorpayPaymentId || '',
                    paidAt: payment.paidAt || new Date()
                }
            }
        },
        { new: true }
    ).lean();

    if (!updated) {
        logger.info(
            `[ONBOARD-PAY] Restaurant ${payment.restaurantId} was already submitted; skipped duplicate submission`
        );
        return null;
    }

    logger.info(`[ONBOARD-PAY] Restaurant ${updated._id} submitted for admin approval after payment`);

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Restaurant Onboarding Request',
            body: `"${updated.restaurantName || 'A restaurant'}" completed its onboarding payment and is awaiting approval.`,
            data: {
                type: 'restaurant_onboarding_submitted',
                subType: 'restaurant',
                id: String(updated._id)
            }
        });
    } catch (error) {
        logger.warn(`[ONBOARD-PAY] Admin notification failed: ${error?.message || error}`);
    }

    try {
        if (updated.ownerEmail) {
            const { sendRestaurantRegistrationReceivedEmail } = await import('../../../../utils/email.js');
            void sendRestaurantRegistrationReceivedEmail({
                to: updated.ownerEmail,
                restaurantName: updated.restaurantName,
                ownerName: updated.ownerName,
                restaurantId: String(updated._id),
                ownerPhone: updated.ownerPhone,
                city: updated.location?.city || updated.city || ''
            });
        }

        const { sendAdminAlertEmail } = await import('../../../../utils/email.js');
        void sendAdminAlertEmail({
            type: 'restaurant_onboarding_submitted',
            subject: `New Restaurant Onboarding (Paid): "${updated.restaurantName}"`,
            title: 'New Restaurant Onboarding (Paid) 🏪',
            message: `Restaurant "${updated.restaurantName}" completed onboarding payment and is pending admin approval.`,
            details: [
                { label: 'Restaurant Name', value: updated.restaurantName },
                { label: 'Owner Name', value: updated.ownerName || '—' },
                { label: 'Phone', value: updated.ownerPhone || '—' },
                { label: 'Email', value: updated.ownerEmail || '—' },
                { label: 'Amount Paid', value: `₹${payment.pricing?.finalAmount ?? 0}` },
                { label: 'Restaurant ID', value: String(updated._id) }
            ]
        });
    } catch (emailErr) {
        logger.warn(`[ONBOARD-PAY] Email notification failed: ${emailErr?.message || emailErr}`);
    }

    return updated;
};

/**
 * Checkout-callback verification. Validates the gateway signature, then independently
 * re-fetches the payment from Razorpay and asserts the order and amount match what the
 * server recorded — the client's numbers are never trusted.
 */
export const verifyOnboardingPayment = async (restaurantId, payload = {}) => {
    const restaurant = await loadOnboardingRestaurant(restaurantId);

    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');

    const payment = await FoodOnboardingPayment.findOne({
        restaurantId: restaurant._id,
        'gateway.razorpayOrderId': orderId
    }).lean();

    if (!payment) throw new NotFoundError('No onboarding payment matches this order');

    if (payment.status === 'paid') {
        return { payment: toOnboardingPaymentView(payment), alreadyProcessed: true };
    }
    // A record can sit in cancelled/failed because the browser mis-reported a dismissal
    // (tab switch, UPI app hop) while the payment was still going through. Never refuse
    // money the gateway actually took — reopen the record and let verification decide.
    let recoveringDiscardedAttempt = false;
    if (payment.status !== 'created') {
        if (!['cancelled', 'failed'].includes(payment.status)) {
            throw new ValidationError('This payment attempt is no longer valid. Please retry the payment.');
        }
        recoveringDiscardedAttempt = true;
        logger.info(
            `[ONBOARD-PAY] Verifying a previously ${payment.status} attempt ${payment._id}; ` +
            'the gateway callback arrived after the browser reported it closed'
        );
    }

    let signatureVerified = false;
    if (isRazorpayConfigured()) {
        if (!signature) {
            logger.warn(`[ONBOARD-PAY-SECURITY] Missing razorpaySignature for verification of order ${orderId}, restaurant ${restaurant._id}`);
            throw new ValidationError('razorpaySignature is required');
        }
        if (!verifyPaymentSignature(orderId, paymentId, signature)) {
            logger.warn(`[ONBOARD-PAY-SECURITY] Signature verification failed for order ${orderId}, payment ${paymentId}, restaurant ${restaurant._id}`);
            throw new ValidationError('Payment verification failed');
        }
        signatureVerified = true;

        try {
            const gatewayPayment = await fetchRazorpayPayment(paymentId);
            assertRazorpayPaymentMatches(gatewayPayment, {
                orderId,
                amountPaise: payment.amountPaise
            });
            const currency = String(gatewayPayment?.currency || 'INR').toUpperCase();
            if (currency !== String(payment.pricing?.currency || 'INR').toUpperCase()) {
                logger.error(`[ONBOARD-PAY-MISMATCH] Currency mismatch for order ${orderId}: expected ${payment.pricing?.currency}, got ${gatewayPayment?.currency}`);
                throw new Error('Payment currency mismatch');
            }
            logger.info(`[ONBOARD-PAY-VERIFIED] Server-side gateway verification passed for order ${orderId}, payment ${paymentId}`);
        } catch (error) {
            logger.error(`[ONBOARD-PAY-MISMATCH] Gateway payment assertion failed for order ${orderId}, payment ${paymentId}: ${error?.message || error}`);
            throw new ValidationError(error?.message || 'Payment verification failed');
        }
    } else if (config.nodeEnv === 'production') {
        logger.error(`[ONBOARD-PAY-CONFIG] Payment gateway is not configured in production environment for restaurant ${restaurant._id}`);
        throw new ValidationError('Payment gateway is not configured');
    } else {
        logger.warn(`[ONBOARD-PAY-DEV] Non-production bypass without Razorpay credentials for restaurant ${restaurant._id}`);
    }

    // The discarded attempt gave its offer slot back; take it again now that the
    // payment is proven, so the snapshot price the customer paid stays honest.
    if (recoveringDiscardedAttempt) {
        await reclaimOfferSlotForRecovery(payment);
    }

    const { payment: finalized, alreadyProcessed } = await finalizeOnboardingPayment({
        payment,
        razorpayPaymentId: paymentId,
        signatureVerified,
        confirmedVia: recoveringDiscardedAttempt ? 'checkout_verify_recovered' : 'checkout_verify'
    });

    const { signRegistrationToken } = await import('../../../../core/auth/onboardingToken.js');
    const registrationToken = restaurant?.ownerPhone ? signRegistrationToken(restaurant.ownerPhone) : null;

    return { payment: toOnboardingPaymentView(finalized), alreadyProcessed, ...(registrationToken ? { registrationToken } : {}) };
};

/**
 * Records a failed/dismissed checkout and hands the offer slot back. Never touches a
 * payment that has already been confirmed.
 */
export const cancelOnboardingPayment = async (restaurantId, payload = {}) => {
    const restaurant = await loadOnboardingRestaurant(restaurantId);
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const reason = String(payload?.reason || '').trim().slice(0, 300);
    const status = payload?.status === 'failed' ? 'failed' : 'cancelled';

    // The client thinks this attempt died, but only the gateway knows for sure.
    // If money was actually taken, record the payment instead of discarding it.
    if (orderId) {
        const pendingRecord = await FoodOnboardingPayment.findOne({
            restaurantId: restaurant._id,
            'gateway.razorpayOrderId': orderId
        }).lean();

        if (pendingRecord?.status === 'paid') {
            return { released: false, paid: true, payment: toOnboardingPaymentView(pendingRecord) };
        }

        if (pendingRecord?.status === 'created') {
            let gatewayPayment = null;
            try {
                gatewayPayment = await findGatewayPaymentForOrder(orderId);
            } catch (err) {
                // Gateway unreachable: leave the attempt open rather than cancelling a
                // payment that may have succeeded. The webhook will settle it.
                logger.warn(`[ONBOARD-PAY-GATEWAY] Gateway check error during cancel for order ${orderId}: ${err?.message || err}`);
                return { released: false, deferred: true, payment: toOnboardingPaymentView(pendingRecord) };
            }

            if (gatewayPayment) {
                try {
                    assertRazorpayPaymentMatches(gatewayPayment, {
                        orderId,
                        amountPaise: pendingRecord.amountPaise
                    });
                    const currency = String(gatewayPayment?.currency || 'INR').toUpperCase();
                    if (currency !== String(pendingRecord.pricing?.currency || 'INR').toUpperCase()) {
                        throw new Error('Payment currency mismatch');
                    }
                    logger.info(
                        `[ONBOARD-PAY-RECOVERY] Client reported ${status} for order ${orderId} but the gateway ` +
                        `captured it (${gatewayPayment.id}); recording the payment instead`
                    );
                    const { payment: finalized } = await finalizeOnboardingPayment({
                        payment: pendingRecord,
                        razorpayPaymentId: gatewayPayment.id,
                        signatureVerified: true,
                        confirmedVia: 'cancel_recovery'
                    });
                    return { released: false, paid: true, payment: toOnboardingPaymentView(finalized) };
                } catch (mismatchErr) {
                    logger.warn(
                        `[ONBOARD-PAY-MISMATCH] Gateway payment found on cancel but failed assertion for order ${orderId}: ${mismatchErr?.message || mismatchErr}`
                    );
                }
            }
        }
    }

    const filter = { restaurantId: restaurant._id, status: 'created' };
    if (orderId) filter['gateway.razorpayOrderId'] = orderId;

    const cancelled = await FoodOnboardingPayment.findOneAndUpdate(
        filter,
        {
            $set: {
                status,
                offerSlotHeld: false,
                reservationExpiresAt: null,
                failureReason: reason || (status === 'failed' ? 'Payment failed' : 'Payment cancelled')
            }
        },
        { new: true, sort: { createdAt: -1 } }
    ).lean();

    if (!cancelled) {
        logger.info(`[ONBOARD-PAY] No active 'created' payment to cancel for restaurant ${restaurant._id}`);
        return { released: false, payment: null };
    }

    if (cancelled.pricing?.offerId) {
        await releaseOfferSlot(cancelled.pricing.offerId);
        logger.info(`[ONBOARD-PAY] Released offer slot after ${status} payment ${cancelled._id}`);
    }

    logger.info(`[ONBOARD-PAY] Payment ${cancelled._id} successfully marked as ${status} (Reason: ${reason || 'N/A'})`);

    return { released: true, payment: toOnboardingPaymentView(cancelled) };
};

/** Used by the central Razorpay webhook to resolve an onboarding payment. */
export const findOnboardingPaymentByGatewayOrderId = async (razorpayOrderId) => {
    if (!razorpayOrderId) return null;
    return FoodOnboardingPayment.findOne({
        'gateway.razorpayOrderId': String(razorpayOrderId)
    }).lean();
};

/** Latest payment record for a restaurant, for admin review screens. */
export const getLatestOnboardingPaymentForRestaurant = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) return null;
    const paid = await FoodOnboardingPayment.findOne({ restaurantId, status: 'paid' }).lean();
    if (paid) return paid;
    return FoodOnboardingPayment.findOne({ restaurantId }).sort({ createdAt: -1 }).lean();
};
