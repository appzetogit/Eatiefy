import { Server } from 'socket.io';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { getFirebaseDB } from './firebase.js';

let io = null;

function logDeliverySocket(message, extra = {}) {
    const suffix = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    // logger.info(`[DeliverySocket] ${message}${suffix}`);
}

function getTokenFromHandshake(socket) {
    const authToken = socket?.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.substring(7).trim();
    const queryToken = socket?.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    return null;
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    return `${trimmed.slice(0, 12)}...${trimmed.slice(-6)}`;
}

const roomNames = {
    restaurant: (id) => `restaurant:${String(id)}`,
    user: (id) => `user:${String(id)}`,
    delivery: (id) => `delivery:${String(id)}`,
    admins: () => 'admins:all',
    tracking: (orderId) => `tracking:${String(orderId)}`
};

/**
 * Initializes Socket.IO with the provided HTTP server.
 * When REDIS_ENABLED=true and REDIS_URL is set, attaches Redis adapter for horizontal scaling.
 * @param {import('http').Server} server
 * @returns {Promise<Server>}
 */
export const initSocket = async (server) => {
    io = new Server(server, {
        cors: {
            origin: config.socketCorsOrigin,
            methods: ['GET', 'POST']
        }
    });

    // Socket auth middleware (Bearer token).
    io.use((socket, next) => {
        try {
            const token = getTokenFromHandshake(socket);
            if (!token) {
                logger.warn(`Socket auth failed: token missing for socket ${socket.id}`);
                logger.warn(`[DeliverySocket] Handshake auth missing`, {
                    socketId: socket.id,
                    origin: socket?.handshake?.headers?.origin || null,
                    host: socket?.handshake?.headers?.host || null,
                    userAgent: socket?.handshake?.headers?.['user-agent'] || null,
                    hasAuthToken: Boolean(socket?.handshake?.auth?.token),
                    hasAuthorizationHeader: Boolean(
                        socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization
                    ),
                    hasQueryToken: Boolean(socket?.handshake?.query?.token),
                });
                return next(new Error('AUTH_MISSING'));
            }
            /* logger.info(`[DeliverySocket] Handshake token received`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(token),
            }); */
            const decoded = verifyAccessToken(token);
            socket.user = { userId: decoded.userId, role: decoded.role };
            // logger.info(`Socket auth success: ${decoded.role}:${decoded.userId} for socket ${socket.id}`);
            return next();
        } catch (err) {
            logger.error(`Socket auth failed for socket ${socket.id}: ${err.message}`);
            logger.error(`[DeliverySocket] Handshake auth invalid`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(getTokenFromHandshake(socket)),
                errorMessage: err.message,
                errorName: err.name || null,
            });
            return next(new Error('AUTH_INVALID'));
        }
    });

    if (config.redisEnabled && config.redisUrl) {
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter');
            const { createClient } = await import('redis');
            const pubClient = createClient({ url: config.redisUrl });
            const subClient = pubClient.duplicate();
            pubClient.on('error', (err) => logger.error(`Socket.IO Redis pub client: ${err.message}`));
            subClient.on('error', (err) => logger.error(`Socket.IO Redis sub client: ${err.message}`));
            await Promise.all([pubClient.connect(), subClient.connect()]);
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.IO Redis adapter attached for horizontal scaling');
        } catch (err) {
            logger.warn(`Socket.IO Redis adapter skipped (using in-memory): ${err.message}`);
        }
    }

    io.on('connection', (socket) => {
        const userId = socket.user?.userId;
        const role = socket.user?.role;
        // logger.info(`Socket client connected: ${socket.id} (${role || 'UNKNOWN'}:${userId || '-'})`);

        // Auto-join role rooms (lets us emit without a custom join).
        if (userId && role) {
            if (role === 'RESTAURANT') socket.join(roomNames.restaurant(userId));
            if (role === 'USER') socket.join(roomNames.user(userId));
            // Every signed-in admin / sub-admin receives live panel alerts
            // (e.g. a new delivery partner waiting for approval).
            if (role === 'ADMIN' || role === 'SUB_ADMIN') {
                socket.join(roomNames.admins());
                // Fresh counts right away, so a panel that just (re)connected is
                // current without waiting for the next broadcast tick.
                void sendAdminBadgesTo(socket);
            }
            if (role === 'DELIVERY_PARTNER') {
                // Private room only. The fleet-wide 'all_delivery' room this
                // used to also join was the one channel through which a rider
                // could receive an event about an order never offered to them;
                // every delivery emit is now addressed to a single partner.
                socket.join(roomNames.delivery(userId));
                logDeliverySocket('Auto-joined delivery room on connect', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId),
                    room: roomNames.delivery(userId),
                });
            }
        }

        // Explicit join (used by existing restaurant client hook).
        socket.on('join-restaurant', (restaurantId) => {
            if (socket.user?.role !== 'RESTAURANT') return;
            // Security: only join your own restaurant room.
            if (String(socket.user?.userId) !== String(restaurantId)) return;
            socket.join(roomNames.restaurant(restaurantId));
            socket.emit('restaurant-room-joined', { room: roomNames.restaurant(restaurantId), restaurantId: String(restaurantId) });
        });

        // Explicit join (used by existing delivery client hook).
        socket.on('join-delivery', (deliveryPartnerId) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') {
                logDeliverySocket('Rejected join-delivery for non-delivery role', {
                    socketId: socket.id,
                    role: socket.user?.role || 'UNKNOWN',
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            // Security: only join your own delivery room.
            if (String(socket.user?.userId) !== String(deliveryPartnerId)) {
                logDeliverySocket('Rejected join-delivery due to user mismatch', {
                    socketId: socket.id,
                    authDeliveryPartnerId: String(socket.user?.userId || ''),
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            const room = roomNames.delivery(deliveryPartnerId);
            socket.join(room);
            const roomSize = io?.sockets?.adapter?.rooms?.get(room)?.size || 0;
            logDeliverySocket('Delivery room joined', {
                socketId: socket.id,
                deliveryPartnerId: String(deliveryPartnerId),
                room,
                roomSize,
            });
            socket.emit('delivery-room-joined', { room, deliveryPartnerId: String(deliveryPartnerId) });
        });

        // ─── Live Tracking Events ───────────────────────────────────────

        // Users / restaurants subscribe to an order's real-time tracking room.
        socket.on('join-tracking', async (orderId) => {
            if (!orderId) return;
            const role = socket.user?.role;
            if (role !== 'USER' && role !== 'RESTAURANT' && role !== 'DELIVERY_PARTNER') return;
            try {
                const {
                    resolveTrackableOrderForViewer,
                    getLastKnownRiderLocation,
                } = await import('../modules/food/delivery/services/riderLocation.service.js');

                // Only the order's own customer, restaurant or assigned rider may watch it.
                const order = await resolveTrackableOrderForViewer(orderId, { userId, role });
                if (!order) {
                    socket.emit('tracking-denied', { orderId: String(orderId) });
                    return;
                }

                // Join under both identifiers so it does not matter which one the rider app publishes with.
                const ids = [...new Set([String(orderId), String(order._id), order.order_id ? String(order.order_id) : ''].filter(Boolean))];
                ids.forEach((id) => socket.join(roomNames.tracking(id)));
                socket.emit('tracking-room-joined', { room: roomNames.tracking(orderId), orderId: String(orderId), orderStatus: order.orderStatus });

                // Paint the bike immediately instead of waiting for the next GPS fix.
                const lastKnown = await getLastKnownRiderLocation(order);
                if (lastKnown) socket.emit('location-update', lastKnown);
            } catch (err) {
                logger.warn(`join-tracking failed for ${role}:${userId} order ${orderId}: ${err.message}`);
            }
        });

        // Delivery partner emits live GPS. The server resolves which orders the rider is
        // actually assigned to and publishes to all of them (tracking rooms, customer,
        // restaurant, Realtime DB) — see riderLocation.service.js.
        socket.on('update-location', async (data) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') return;
            if (!data) return;
            try {
                const { publishRiderLocation } = await import('../modules/food/delivery/services/riderLocation.service.js');
                await publishRiderLocation({
                    deliveryPartnerId: userId,
                    lat: data.lat,
                    lng: data.lng,
                    heading: data.heading,
                    speed: data.speed,
                    accuracy: data.accuracy,
                    timestamp: data.timestamp,
                    requestedOrderId: data.orderId || null,
                    source: 'socket',
                    excludeSocket: socket,
                });
            } catch (err) {
                logger.error(`update-location failed for ${userId}: ${err.message}`);
            }
        });

        // Customer emits live GPS position. The server broadcasts to tracking room and assigned delivery partner.
        socket.on('update-user-location', async (data) => {
            if (socket.user?.role !== 'USER') return;
            if (!data) return;
            try {
                const { resolveTrackableOrderForViewer, isValidCoordinate } = await import('../modules/food/delivery/services/riderLocation.service.js');
                const lat = Number(data.lat);
                const lng = Number(data.lng);
                if (!isValidCoordinate(lat, lng)) return;

                const order = await resolveTrackableOrderForViewer(data.orderId, { userId, role });
                if (!order) return;

                const now = Date.now();
                const payload = {
                    orderId: order.order_id ? String(order.order_id) : String(order._id),
                    orderMongoId: String(order._id),
                    userId: String(userId),
                    lat,
                    lng,
                    accuracy: Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null,
                    timestamp: now,
                };

                const ids = [...new Set([String(data.orderId), String(order._id), order.order_id ? String(order.order_id) : ''].filter(Boolean))];
                let target = io;
                for (const id of ids) {
                    target = target.to(roomNames.tracking(id));
                }
                const partnerId = order.dispatch?.deliveryPartnerId;
                if (partnerId) {
                    target = target.to(roomNames.delivery(partnerId));
                }
                target.emit('user_live_location', payload);

                try {
                    const db = getFirebaseDB();
                    if (db) {
                        for (const id of ids) {
                            db.ref(`active_orders/${id.replace(/[.#$/[\]]/g, '_')}/user_live_location`).update(payload).catch(() => {});
                        }
                    }
                } catch {}
            } catch (err) {
                logger.error(`update-user-location failed for ${userId}: ${err.message}`);
            }
        });

        // Leave tracking room on user navigation away.
        socket.on('leave-tracking', (orderId) => {
            if (!orderId) return;
            const room = roomNames.tracking(orderId);
            socket.leave(room);
        });

        socket.on('disconnect', () => {
            // logger.info(`Socket client disconnected: ${socket.id}`);
            if (role === 'DELIVERY_PARTNER') {
                logDeliverySocket('Delivery socket disconnected', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId || ''),
                });
            }
        });

        // 🆕 Resync State on Reconnect
        socket.on('resync', async () => {
          try {
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync requested', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
              });
            }
            const { resyncState } = await import('../modules/food/orders/services/order.service.js');
            const state = await resyncState(userId, role);
            if (state.activeOrders?.length) {
              socket.emit('active_orders', state.activeOrders);
              if (state.capacity) {
                socket.emit('delivery_capacity', state.capacity);
              }
            }
            if (state.activeOrder) {
              const eventName = role === 'USER' ? 'order_state' : 'active_order';
              socket.emit(eventName, state.activeOrder);
              if (role === 'DELIVERY_PARTNER') {
                logDeliverySocket('Resync emitted active order', {
                  socketId: socket.id,
                  deliveryPartnerId: String(userId || ''),
                  orderId: String(
                    state.activeOrder?.orderId ||
                    state.activeOrder?.orderMongoId ||
                    ''
                  ),
                  eventName,
                });
              }
              
              // Re-emit OTP if user is in drop phase
              if (role === 'USER' && state.activeOrder.handoverOtp) {
                socket.emit('delivery_drop_otp', {
                  orderId: state.activeOrder.orderId,
                  otp: state.activeOrder.handoverOtp,
                  message: 'Share this OTP with your delivery partner.'
                });
              }
            }
            socket.emit('resync_complete', { timestamp: Date.now() });
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync complete', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
                hasActiveOrder: Boolean(state.activeOrder),
                activeOrderCount: Array.isArray(state.activeOrders) ? state.activeOrders.length : 0,
              });
            }
          } catch (err) {
            logger.error(`Resync failed for ${role}:${userId} — ${err.message}`);
          }
        });
    });

    startAdminBadgeBroadcaster();

    logger.info('Socket.IO infrastructure initialized');
    return io;
};

// ─── Live admin panel updates ───────────────────────────────────────────────
// Every admin notification / pending-count change reaches an open panel through
// here, so nothing waits for a manual refresh. Not queued anywhere: BullMQ is not
// involved, and the broadcaster runs inside the API process itself.
const ADMIN_BADGE_TICK_MS = 8000;
let lastAdminBadgesJson = '';
let adminBadgeTimer = null;

const loadAdminBadges = async () => {
    const { getSidebarBadges } = await import('../modules/food/admin/services/admin.service.js');
    return getSidebarBadges();
};

const sendAdminBadgesTo = async (socket) => {
    try {
        socket.emit('admin_badges_update', { counts: await loadAdminBadges(), initial: true });
    } catch (err) {
        logger.warn(`[Socket] initial admin badges failed: ${err?.message || err}`);
    }
};

const startAdminBadgeBroadcaster = () => {
    if (adminBadgeTimer) return;
    adminBadgeTimer = setInterval(async () => {
        try {
            const adminRoom = io?.sockets?.adapter?.rooms?.get(roomNames.admins());
            if (!adminRoom || adminRoom.size === 0) return; // nobody to tell
            const counts = await loadAdminBadges();
            const json = JSON.stringify(counts);
            if (json === lastAdminBadgesJson) return;
            lastAdminBadgesJson = json;
            io.to(roomNames.admins()).emit('admin_badges_update', { counts });
        } catch (err) {
            logger.warn(`[Socket] admin badge broadcast failed: ${err?.message || err}`);
        }
    }, ADMIN_BADGE_TICK_MS);
    adminBadgeTimer.unref?.();
};

/**
 * Socket.IO for a background worker process (BullMQ), which has no HTTP server
 * of its own and therefore never ran initSocket(). Without this every emit from
 * a job — dispatch offers, order status updates, tracking — hit a null `io` and
 * was dropped with a warning, so clients with the app open saw nothing until
 * they refreshed or resynced.
 *
 * The instance is deliberately detached (no httpServer, never listens): it only
 * publishes through the Redis adapter, and the API process's Socket.IO server
 * receives those and delivers them to the actually-connected sockets.
 *
 * Gated on the SAME condition as the adapter in initSocket. If the API has no
 * adapter attached it cannot receive what this publishes, so initializing
 * anyway would convert a visible warning into a silent black hole.
 *
 * @returns {Promise<Server | null>}
 */
export const initSocketEmitter = async () => {
    if (io) return io;

    if (!config.redisEnabled || !config.redisUrl) {
        logger.warn(
            '[Socket] Worker emit disabled: REDIS_ENABLED/REDIS_URL not set. Background jobs ' +
            'cannot reach connected clients in real time (push still works). Set REDIS_ENABLED=true ' +
            'on the API and the workers to turn this on.'
        );
        return null;
    }

    try {
        const { createAdapter } = await import('@socket.io/redis-adapter');
        const { createClient } = await import('redis');
        const pubClient = createClient({ url: config.redisUrl });
        const subClient = pubClient.duplicate();
        pubClient.on('error', (err) => logger.error(`Socket.IO Redis pub client: ${err.message}`));
        subClient.on('error', (err) => logger.error(`Socket.IO Redis sub client: ${err.message}`));
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io = new Server({ adapter: createAdapter(pubClient, subClient) });
        logger.info('[Socket] Worker emitter ready (publishes to the API via Redis adapter)');
        return io;
    } catch (err) {
        logger.warn(`[Socket] Worker emitter unavailable, job emits will be dropped: ${err.message}`);
        return null;
    }
};

/**
 * Returns the initialized Socket.IO instance.
 * @returns {Server | null}
 */
export const getIO = () => {
    if (!io) {
        logger.warn('Socket.IO not initialized');
    }
    return io;
};

export const rooms = roomNames;

/**
 * Best-effort live alert to every connected admin panel. Never throws: the
 * registration / approval flow that calls this must not fail because a socket
 * could not be reached.
 */
export const emitToAdmins = (event, payload = {}) => {
    try {
        const server = io;
        if (!server) return false;
        server.to(roomNames.admins()).emit(event, payload);
        return true;
    } catch (err) {
        logger.warn(`[Socket] emitToAdmins(${event}) failed: ${err?.message || err}`);
        return false;
    }
};
