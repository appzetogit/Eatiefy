import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        ownerType: {
            type: String,
            enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER'],
            required: true,
            index: true
        },
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        link: {
            type: String,
            default: '',
            trim: true
        },
        category: {
            type: String,
            default: 'broadcast',
            trim: true
        },
        source: {
            type: String,
            enum: ['ADMIN_BROADCAST', 'FSSAI_EXPIRY', 'ORDER_UPDATE', 'RESTAURANT_APPROVAL', 'DELIVERY_PARTNER_APPROVAL', 'SUPPORT_TICKET_REPLY'],
            default: 'ADMIN_BROADCAST',
            index: true
        },
        broadcastId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'BroadcastNotification',
            default: null,
            index: true
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        isRead: {
            type: Boolean,
            default: false,
            index: true
        },
        readAt: {
            type: Date,
            default: null
        },
        dismissedAt: {
            type: Date,
            default: null,
            index: true
        }
    },
    {
        collection: 'food_notifications',
        timestamps: true
    }
);

notificationSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
notificationSchema.index({ ownerType: 1, ownerId: 1, isRead: 1, dismissedAt: 1 });
// One row per (broadcast, owner). A compound *sparse* index still covers every
// document here (ownerType/ownerId always exist), which would have capped each
// owner at a single non-broadcast notification — hence the partial filter.
notificationSchema.index(
    { broadcastId: 1, ownerType: 1, ownerId: 1 },
    {
        unique: true,
        name: 'broadcastId_1_ownerType_1_ownerId_1',
        partialFilterExpression: { broadcastId: { $type: 'objectId' } }
    }
);
// TTL Index: Auto-delete notifications older than 3 days (259,200 seconds) for 512MB Free DB Tier safety
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

export const FoodNotification = mongoose.model('FoodNotification', notificationSchema);

/**
 * Older deployments built the index above as `sparse` instead of partial, which
 * made a second non-broadcast notification for the same owner fail with a
 * duplicate-key error (approval notices were silently dropped). Drop the stale
 * definition once at startup so Mongoose can rebuild it with the partial filter.
 */
export const reconcileNotificationIndexes = async () => {
    const collection = FoodNotification.collection;
    const indexes = await collection.indexes().catch(() => []);
    const stale = indexes.find(
        (index) =>
            index.name === 'broadcastId_1_ownerType_1_ownerId_1' &&
            index.sparse === true &&
            !index.partialFilterExpression
    );
    if (!stale) return false;

    await collection.dropIndex(stale.name);
    await FoodNotification.createIndexes();
    return true;
};
