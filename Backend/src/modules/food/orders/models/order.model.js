import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 0 },
        /** Restaurant base at order time. */
        basePrice: { type: Number, default: null, min: 0 },
        /** @deprecated Prefer markupAmount; kept for older order docs. */
        otherPrice: { type: Number, default: 0, min: 0 },
        /** Admin markup per unit (platform share). */
        markupAmount: { type: Number, default: 0, min: 0 },
        appliedPricingType: { type: String, default: null },
        appliedPricingValue: { type: Number, default: null },
        pricingScope: { type: String, default: null },
        pricingRule: { type: mongoose.Schema.Types.Mixed, default: null },
        quantity: { type: Number, required: true, min: 1 },
        isVeg: { type: Boolean, default: true },
        image: { type: String, default: '' },
        notes: { type: String, default: '' },
        /** Restaurant offer on this line: unit price before it and the per-unit amount taken off. */
        priceBeforeOffer: { type: Number, default: null, min: 0 },
        offerDiscount: { type: Number, default: 0, min: 0 },
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurantOffer', default: null },
        offerTitle: { type: String, trim: true, default: '' }
    },
    { _id: false }
);

const appliedRestaurantOfferSchema = new mongoose.Schema(
    {
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurantOffer' },
        title: { type: String, trim: true, default: '' },
        label: { type: String, trim: true, default: '' },
        discount: { type: Number, default: 0, min: 0 }
    },
    { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
    {
        label: { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home' },
        name: { type: String, default: '', trim: true },
        fullName: { type: String, default: '', trim: true },
        street: { type: String, required: true, trim: true },
        additionalDetails: { type: String, default: '', trim: true },
        /** House / flat number the customer typed at checkout. */
        houseNumber: { type: String, default: '', trim: true },
        landmark: { type: String, default: '', trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        zipCode: { type: String, default: '', trim: true },
        phone: { type: String, default: '', trim: true },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: undefined }
        }
    },
    { _id: false }
);

const pricingSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, required: true, min: 0 },
        /** Restaurant-owned item total (before admin markup). */
        baseSubtotal: { type: Number, default: 0, min: 0 },
        /** Admin markup total (goes to platform). */
        markupTotal: { type: Number, default: 0, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
        couponCode: { type: String, default: null, trim: true, uppercase: true },
        /**
         * Restaurant-run offers. Already reflected in the item prices, subtotal and
         * baseSubtotal (the restaurant funds them); stored for receipts and reporting.
         */
        restaurantOfferDiscount: { type: Number, default: 0, min: 0 },
        restaurantOffers: { type: [appliedRestaurantOfferSchema], default: [] }
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'],
            required: true
        },
        status: {
            type: String,
            enum: [
                'cod_pending',
                'created',
                'authorized',
                'paid',
                'failed',
                'refunded',
                'pending_qr',
                // Takeaway "Pay at Pickup (online)": order is placed but not yet
                // paid. It is intentionally NOT in the paid set, so the restaurant
                // is never notified/alarmed and never starts preparing until the
                // customer pays online at the counter.
                'awaiting_pickup_payment'
            ],
            default: 'cod_pending'
        },
        // True for takeaway orders placed with "Pay at Pickup (online)". Kept even
        // after payment (status flips to 'paid') so UIs/queries can recognise the
        // mode in history.
        payAtPickup: { type: Boolean, default: false },
        amountDue: { type: Number, min: 0 },
        razorpay: {
            orderId: { type: String },
            paymentId: { type: String },
            signature: { type: String }
        },
        qr: {
            qrId: { type: String },
            imageUrl: { type: String },
            paymentLinkId: { type: String },
            shortUrl: { type: String },
            status: { type: String },
            expiresAt: { type: Date }
        },
        // ✅ NEW: Added refund object to track refund status without breaking existing flow
        refund: {
            status: { 
                type: String, 
                enum: ['none', 'pending', 'processed', 'failed'], 
                default: 'none' 
            },
            destination: {
                type: String,
                enum: ['source', 'wallet'],
                default: 'source'
            },
            amount: { type: Number, default: 0 },
            refundId: { type: String, default: '' },
            processedAt: { type: Date }
        }
    },
    { _id: false }
);

const dispatchSchema = new mongoose.Schema(
    {
        modeAtCreation: { type: String, enum: ['auto'], default: 'auto' },
        status: {
            type: String,
            enum: ['unassigned', 'assigned', 'accepted', 'rejected', 'cancelled'],
            default: 'unassigned'
        },
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
        assignedAt: { type: Date },
        acceptedAt: { type: Date },
        /** List of partners who were offered this order (to avoid repeats and track timeouts) */
        offeredTo: [{
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner' },
            at: { type: Date, default: Date.now },
            /** Creation stamp. Same instant as `at`, under the canonical name. */
            createdAt: { type: Date, default: Date.now },
            action: { type: String, enum: ['offered', 'rejected', 'timeout'], default: 'offered' },
            /**
             * When this offer stops being acceptable. The backend - not a
             * frontend timer - is the authority: the available-orders query,
             * the atomic accept guard and the expiry sweeper all read it
             * through delivery-offer.util.js, which also caps every offer at
             * ten minutes from creation and treats a row with no stamp at all
             * as already expired rather than as immortal.
             */
            expiresAt: { type: Date },
            allowOverLimit: { type: Boolean, default: false },
            requiredCashForOrder: { type: Number, default: 0 }
        }],
        dispatchingAt: { type: Date }
    },
    { _id: false }
);

const deliveryStateSchema = new mongoose.Schema(
    {
        currentPhase: {
            type: String,
            enum: [
                'en_route_to_pickup',
                'at_pickup',
                'en_route_to_delivery',
                'at_drop',
                'delivered',
                'completed'
            ],
            default: 'en_route_to_pickup'
        },
        status: { type: String, default: '' },
        reachedPickupAt: { type: Date, default: null },
        reachedDropAt: { type: Date, default: null },
        pickedUpAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null }
    },
    { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
    {
        at: { type: Date, default: Date.now },
        byRole: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN', 'SYSTEM'] },
        byId: { type: mongoose.Schema.Types.ObjectId },
        from: { type: String },
        to: { type: String },
        note: { type: String, default: '' }
    },
    { _id: false }
);

const orderEntityRatingSchema = new mongoose.Schema(
    {
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, default: '', trim: true },
        ratedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const orderRatingsSchema = new mongoose.Schema(
    {
        restaurant: { type: orderEntityRatingSchema, default: undefined },
        deliveryPartner: { type: orderEntityRatingSchema, default: undefined }
    },
    { _id: false }
);

const deliveryVerificationSchema = new mongoose.Schema(
    {
        dropOtp: {
            required: { type: Boolean, default: false },
            verified: { type: Boolean, default: false }
        }
    },
    { _id: false }
);

const eatiefyIncentiveSchema = new mongoose.Schema(
    {
        percent: { type: Number, required: true, min: 0, max: 100 },
        orderValueBasis: { type: String, enum: ['subtotal', 'total'], required: true },
        orderValue: { type: Number, required: true, min: 0 },
        amount: { type: Number, required: true, min: 0 },
        /** Zone whose incentive setting was applied. */
        zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodZone', default: null },
        calculatedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const restaurantAlarmSchema = new mongoose.Schema(
    {
        active: { type: Boolean, default: false },
        startedAt: { type: Date, default: null },
        lastRingAt: { type: Date, default: null },
        ringCount: { type: Number, default: 0, min: 0 },
        // Last ring that started a VoIP call on the restaurant's iPhones; the call
        // rings on its own until then, so only a ring after it ends starts another.
        lastVoipCallAt: { type: Date, default: null },
        stoppedAt: { type: Date, default: null }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        order_id: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        /** Compatibility alias: satisfies rogue unique index 'orderId_1' found in legacy deployments. */
        orderId: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        orderType: {
            type: String,
            enum: ['delivery', 'dining', 'takeaway'],
            default: 'delivery',
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            required: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            index: true
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodTransaction',
            index: true
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: (v) => Array.isArray(v) && v.length > 0
        },
        deliveryAddress: {
            type: deliveryAddressSchema,
            required: false
        },
        customerName: { type: String, default: '', trim: true },
        customerPhone: { type: String, default: '', trim: true },
        pricing: {
            type: pricingSchema,
            required: false
        },
        /**
         * Denormalized payment snapshot for fast reads & legacy clients.
         * Authoritative audit trail: collection `food_order_payments` (FoodOrderPayment model).
         */
        payment: {
            type: paymentSchema,
            required: false
        },
        orderStatus: {
            type: String,
            enum: [
                'created',
                'confirmed',
                'preparing',
                'ready_for_pickup',
                'reached_pickup',
                'picked_up',
                'reached_drop',
                'delivered',
                'cancelled_by_user',
                'cancelled_by_restaurant',
                'cancelled_by_admin'
            ],
            default: 'created'
        },
        dispatch: {
            type: dispatchSchema,
            default: () => ({})
        },
        deliveryState: {
            type: deliveryStateSchema,
            default: () => ({})
        },
        statusHistory: {
            type: [statusHistorySchema],
            default: []
        },
        ratings: {
            type: orderRatingsSchema,
            default: () => ({})
        },
        restaurantNote: { type: String, default: '', trim: true },
        note: { type: String, default: '', trim: true },
        cancellationReason: { type: String, default: '', trim: true },
        cancelledAt: { type: Date, default: null },
        cancelledBy: { type: String, default: '', trim: true },
        sendCutlery: { type: Boolean, default: true },
        preparationTime: { type: Number, default: 0 },
        acceptedAt: { type: Date },
        deliveryFleet: { type: String, default: 'standard', trim: true },
        scheduledAt: { type: Date, default: null },
        // First time the restaurant was sent this order; its accept window counts from here.
        restaurantNotifiedAt: { type: Date, default: null },
        /**
         * New-order alarm on the restaurant's phone. While `active`, the push is
         * repeated (restaurantOrderAlarm.service) so it keeps ringing with the app
         * closed; once the order is answered a "stop" push silences the alarm.
         */
        restaurantAlarm: {
            type: restaurantAlarmSchema,
            default: undefined
        },
        /**
         * Restaurant → delivery-address distance in km, resolved at order time
         * alongside the rider earning. It was previously written by the
         * background geocode update but never declared here, so Mongoose's
         * strict mode silently dropped it and the distance was lost.
         */
        distanceKm: { type: Number, default: null, min: 0 },
        /**
         * Total delivery partner payout for this order
         * (= riderBaseEarning + eatiefyIncentive.amount). Every wallet,
         * pocket, settlement and report aggregate reads this field.
         */
        riderEarning: { type: Number, default: 0, min: 0 },
        /**
         * Zone-wise commission payout portion of riderEarning. Null on orders
         * created before the Eatiefy incentive existed (riderEarning is then
         * entirely the base earning).
         */
        riderBaseEarning: { type: Number, default: null, min: 0 },
        /**
         * Zone-wise admin Eatiefy incentive snapshotted at order creation.
         * Null when no incentive applied. Never recalculated afterwards.
         */
        eatiefyIncentive: {
            type: eatiefyIncentiveSchema,
            default: null
        },
        platformProfit: { type: Number, default: 0, min: 0 },
        /** Plain 4-digit OTP for handover; cleared after successful verify (never expose to partner in API responses). */
        deliveryOtp: { type: String, default: '', select: false },
        deliveryVerification: {
            type: deliveryVerificationSchema,
            default: () => ({})
        },
        /** Latest rider location for this specific order (GeoJSON Point) */
        lastRiderLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        },
        // When lastRiderLocation was recorded, so clients never show an old fix as live.
        lastRiderLocationAt: { type: Date, default: null }
    },
    {
        collection: 'food_orders',
        timestamps: true
    }
);

orderSchema.index({ 'deliveryAddress.location': '2dsphere' });
orderSchema.index({ lastRiderLocation: '2dsphere' });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1, updatedAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, 'dispatch.status': 1, updatedAt: -1 });
// Serves the rider-facing "orders offered to me" query, which filters on the
// offer sub-document rather than on zone.
orderSchema.index({ 'dispatch.offeredTo.partnerId': 1, 'dispatch.status': 1, orderStatus: 1 });
// Drives the offer-expiry sweeper, which scans for pending offers past their window.
orderSchema.index({ 'dispatch.offeredTo.action': 1, 'dispatch.offeredTo.expiresAt': 1 });
// Drives the restaurant alarm sweep; only orders currently ringing are indexed.
orderSchema.index(
    { 'restaurantAlarm.active': 1 },
    { partialFilterExpression: { 'restaurantAlarm.active': true } }
);
orderSchema.index({ 'payment.status': 1, createdAt: -1 });
orderSchema.index({ 'payment.method': 1, createdAt: -1 });
// One Razorpay payment pays for one order (blocks replay and webhook/app double-create).
orderSchema.index(
    { 'payment.razorpay.paymentId': 1 },
    { unique: true, partialFilterExpression: { 'payment.razorpay.paymentId': { $gt: '' } } }
);

orderSchema.pre('save', async function (next) {
    if (!this.order_id) {
        const timestamp = Date.now().toString().slice(-4);
        const random = Math.floor(100 + Math.random() * 900);
        this.order_id = `FOD-${timestamp}${random}`;
    }
    // Synchronize camelCase alias to satisfy unique index 'orderId_1'
    if (this.order_id) {
        this.orderId = this.order_id;
    }
    // Auto-generate takeaway OTP for active states if missing
    if (this.orderType === 'takeaway' && ['preparing', 'ready_for_pickup'].includes(this.orderStatus)) {
        if (!this.deliveryOtp) {
            this.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
        }
        if (!this.deliveryVerification || !this.deliveryVerification.dropOtp || !this.deliveryVerification.dropOtp.required) {
            this.deliveryVerification = {
                ...(this.deliveryVerification?.toObject?.() || this.deliveryVerification || {}),
                dropOtp: { required: true, verified: false }
            };
        }
    }
    // Remembered for the post-save hook below (isModified is reset after saving).
    this.$locals.orderStatusChanged = this.isModified('orderStatus');
    next();
});

const TRACKING_TERMINAL_STATUSES = new Set([
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin'
]);

/*
 * Live rider tracking must stop the moment an order is delivered or cancelled,
 * whichever service (rider, restaurant, customer, admin) made that change. Doing
 * it here covers every save() path instead of each status-change function.
 */
orderSchema.post('save', function (doc) {
    if (!doc?.$locals?.orderStatusChanged) return;
    if (!TRACKING_TERMINAL_STATUSES.has(String(doc.orderStatus || ''))) return;
    import('../../delivery/services/riderLocation.service.js')
        .then(({ endRiderTracking }) =>
            endRiderTracking(doc, doc.orderStatus === 'delivered' ? 'delivered' : 'cancelled')
        )
        .catch(() => {});
});

/*
 * Commission-mode user referrals are paid out the moment a user's first order
 * is delivered (see userReferral.service.js), not at signup - so a cancelled
 * or never-paid order pays nothing. Hooked here so it fires regardless of
 * which service (rider, restaurant, admin) made the 'delivered' transition.
 */
orderSchema.post('save', function (doc) {
    if (!doc?.$locals?.orderStatusChanged) return;
    if (String(doc.orderStatus || '') !== 'delivered') return;
    import('../../user/services/userReferral.service.js')
        .then(({ payUserReferralCommissionOnDelivery }) => payUserReferralCommissionOnDelivery(doc))
        .catch(() => {});
});

export const FoodOrder = mongoose.model('FoodOrder', orderSchema);

const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        dispatchMode: { type: String, enum: ['auto'], default: 'auto' },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date }
        }
    },
    { collection: 'food_settings', timestamps: true }
);

export const FoodSettings = mongoose.model('FoodSettings', settingsSchema);
