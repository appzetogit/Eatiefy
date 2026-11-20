import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { detectZoneIdForPoint } from '../../utils/zoneGeo.js';
import { DeliverySupportTicket } from '../models/supportTicket.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodEarningAddon } from '../../admin/models/earningAddon.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { stripDeliveryPricingInternals } from '../../orders/services/order.helpers.js';
import { uploadImageBuffer, deleteReplacedAssets } from '../../../../services/storage.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    DELIVERY_DOC_FOLDERS,
    DELIVERY_DRAFT_FIELDS,
    DELIVERY_DOC_MAX_WIDTH,
    resolveDeliveryDraftImagesForRegistration,
    clearDeliveryDraft
} from './deliveryOnboardingDraft.service.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { logger } from '../../../../utils/logger.js';
import {
  toStartOfDayInTimeZone,
  toEndOfDayInTimeZone,
  getWeekRangeInTimeZone,
  getMonthRangeInTimeZone,
  APP_TIMEZONE,
} from '../../../../utils/timezone.js';

export const normalizeDeliveryPhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.slice(-10) || null;
};

const escapeDeliveryPhoneRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findDeliveryPartnerByPhone = async (phone) => {
    const normalized = normalizeDeliveryPhone(phone);
    if (!normalized) return null;

    const candidates = Array.from(
        new Set([normalized, `91${normalized}`, `+91${normalized}`, `0${normalized}`])
    );
    const suffixPattern = new RegExp(`${escapeDeliveryPhoneRegex(normalized)}$`);

    const matchingPartners = await FoodDeliveryPartner.find({
        $or: [
            { phone: { $in: candidates } },
            { phone: { $regex: suffixPattern } },
        ],
    });

    const statusPriority = { approved: 1, pending: 2, rejected: 3, deleted: 4 };
    return (
        matchingPartners.sort((a, b) => {
            const pA = statusPriority[a.status] || 99;
            const pB = statusPriority[b.status] || 99;
            return pA - pB;
        })[0] || null
    );
};

const formatDeliveryDuplicateKeyError = (err) => {
    if (!err || err.code !== 11000) return null;

    const keyPattern = err.keyPattern || {};
    const keyValue = err.keyValue || {};

    if (keyPattern.phone || keyValue.phone !== undefined) {
        return 'Delivery partner with this phone number already exists';
    }
    if (keyPattern.vehicleNumber || keyValue.vehicleNumber !== undefined) {
        return 'This vehicle number is already registered. Please use a different vehicle number.';
    }
    if (keyPattern.panNumber || keyValue.panNumber !== undefined) {
        return 'This PAN number is already registered.';
    }
    if (keyPattern.aadharNumber || keyValue.aadharNumber !== undefined) {
        return 'This Aadhar number is already registered.';
    }
    if (keyPattern.drivingLicenseNumber || keyValue.drivingLicenseNumber !== undefined) {
        return 'This driving license number is already registered.';
    }

    return 'This account detail is already registered. Please check your information.';
};

const clearPartnerForReRegistration = async (existing) => {
    if (!existing) return;

    if (existing.status === 'rejected') {
        await FoodDeliveryPartner.deleteOne({ _id: existing._id });
        return;
    }

    if (existing.status === 'deleted') {
        existing.phone = `${existing.phone}_deleted_${Date.now()}`;
        await existing.save();
    }
};

/** Keep FCM arrays on the in-memory doc in sync before partner.save() (avoids wiping tokens). */
function appendPartnerFcmToken(partner, fcmToken, platform = 'web') {
    const token = String(fcmToken || '').trim();
    if (!token || !partner) return;
    const field = platform === 'mobile' ? 'fcmTokenMobile' : 'fcmTokens';
    const existing = Array.isArray(partner[field]) ? partner[field] : [];
    if (existing.includes(token)) return;
    partner[field] = [...existing, token].slice(-10);
}

export const resolveZoneIdForPartner = async ({ zoneId, city, address, state, lat, lng } = {}) => {
    // 1. Direct zoneId provided (signup / admin edit)
    if (zoneId && mongoose.Types.ObjectId.isValid(String(zoneId))) {
        const zone = await FoodZone.findById(zoneId).select('_id isActive').lean();
        if (zone) return zone._id;
    }

    // 2. GPS coordinates provided
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        try {
            const detected = await detectZoneIdForPoint(Number(lat), Number(lng));
            if (detected) return detected;
        } catch {
            /* ignore */
        }
    }

    // 3. Match against active zones by city, address, or state
    const candidates = [city, address, state].map((s) => String(s || '').trim()).filter(Boolean);
    if (candidates.length === 0) return null;

    const activeZones = await FoodZone.find({ isActive: true })
        .select('_id name zoneName serviceLocation')
        .lean();
    if (!activeZones.length) return null;

    // Exact string match (case-insensitive)
    for (const text of candidates) {
        const tLower = text.toLowerCase();
        for (const z of activeZones) {
            const names = [z.name, z.zoneName, z.serviceLocation]
                .filter(Boolean)
                .map((s) => s.trim().toLowerCase());
            if (names.includes(tLower)) return z._id;
        }
    }

    // Token match (e.g. "Indore, MP" -> "Indore"). Localities can carry another
    // city's name - Indore has "Ratlam Kothi" - and the first zone word found used
    // to win, so "Ratlam Kothi, Indore" landed in the Ratlam zone. Addresses run
    // locality -> city -> state, so the zone named LAST in a text is its city;
    // and the city field is trusted before the address.
    const lastZoneNamedIn = (text) => {
        const words = text.toLowerCase().split(/[\s,.()/-]+/).filter((w) => w.length >= 3);
        for (let i = words.length - 1; i >= 0; i -= 1) {
            const zone = activeZones.find((z) =>
                [z.name, z.zoneName, z.serviceLocation]
                    .filter(Boolean)
                    .map((n) => n.trim().toLowerCase())
                    .includes(words[i])
            );
            if (zone) return zone._id;
        }
        return null;
    };
    for (const text of candidates) {
        const zoneIdFromText = lastZoneNamedIn(text);
        if (zoneIdFromText) return zoneIdFromText;
    }

    return null;
};

export const registerDeliveryPartner = async (payload, files, draftImageRefs = {}) => {
    const { 
        name, phone, email, countryCode, address, city, state, zoneId,
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber, panNumber, aadharNumber,
        fcmToken, platform 
    } = payload;
    const refRaw = typeof payload?.ref === 'string' ? String(payload.ref).trim() : '';
    const normalizedPhone = normalizeDeliveryPhone(phone);

    if (!normalizedPhone) {
        throw new ValidationError('Valid phone number is required');
    }

    const existing = await findDeliveryPartnerByPhone(normalizedPhone);
    if (existing) {
        if (existing.status === 'pending') {
            throw new ValidationError(
                'Registration with this phone is already submitted and pending admin approval. Please check Join Requests in admin panel.'
            );
        }
        if (existing.status === 'approved') {
            throw new ValidationError('Delivery partner with this phone number already exists. Please login instead.');
        }
        await clearPartnerForReRegistration(existing);
    }

    const normalizedVehicleNumber = vehicleNumber
        ? String(vehicleNumber).trim().toUpperCase()
        : undefined;

    if (normalizedVehicleNumber) {
        const existingVehicle = await FoodDeliveryPartner.findOne({
            vehicleNumber: normalizedVehicleNumber,
        }).select('_id phone status').lean();

        if (existingVehicle) {
            throw new ValidationError(
                'This vehicle number is already registered. Please use a different vehicle number.'
            );
        }
    }

    // Photos already stored through the signup draft; only URLs recorded for this
    // phone are accepted. A multipart file for the same field still takes priority.
    const draftImages = await resolveDeliveryDraftImagesForRegistration(normalizedPhone, draftImageRefs);

    const images = {};
    for (const field of DELIVERY_DRAFT_FIELDS) {
        if (files?.[field]?.[0]) {
            images[field] = await uploadImageBuffer(files[field][0].buffer, DELIVERY_DOC_FOLDERS[field], { maxWidth: DELIVERY_DOC_MAX_WIDTH });
        } else if (draftImages[field]) {
            images[field] = draftImages[field];
        }
    }

    const normalizedEmail =
        email && String(email).trim() ? String(email).trim().toLowerCase() : undefined;

    const resolvedZoneId = await resolveZoneIdForPartner({
        zoneId,
        city,
        address,
        state
    });

    let partner;

    try {
        partner = await FoodDeliveryPartner.create({
            name,
            phone: normalizedPhone,
            email: normalizedEmail,
            countryCode,
            address,
            city,
            state,
            zoneId: resolvedZoneId || undefined,
            vehicleType,
            vehicleName,
            vehicleNumber: normalizedVehicleNumber,
            drivingLicenseNumber,
            panNumber,
            aadharNumber,
            status: 'pending',
            ...(fcmToken
                ? (platform === 'mobile'
                    ? { fcmTokenMobile: [String(fcmToken).trim()] }
                    : { fcmTokens: [String(fcmToken).trim()] })
                : {}),
            ...images
        });
    } catch (err) {
        const duplicateMessage = formatDeliveryDuplicateKeyError(err);
        if (duplicateMessage) {
            throw new ValidationError(duplicateMessage);
        }
        throw err;
    }

    // The partner record now references the uploaded photos.
    await clearDeliveryDraft(normalizedPhone);

    const postCreateSet = {};
    if (!partner.referralCode) {
        postCreateSet.referralCode = String(partner._id);
    }

    // Store referredBy (no credit here; credit happens on admin approval).
    if (refRaw && mongoose.Types.ObjectId.isValid(refRaw) && String(refRaw) !== String(partner._id)) {
        const referrer = await FoodDeliveryPartner.findById(refRaw).select('_id').lean();
        if (referrer) {
            postCreateSet.referredBy = referrer._id;
        }
    }

    if (Object.keys(postCreateSet).length) {
        await FoodDeliveryPartner.updateOne({ _id: partner._id }, { $set: postCreateSet });
        Object.assign(partner, postCreateSet);
    }

    if (fcmToken) {
        try {
            const { upsertFirebaseDeviceToken } = await import('../../../../core/notifications/firebase.service.js');
            await upsertFirebaseDeviceToken({
                ownerType: 'DELIVERY_PARTNER',
                ownerId: String(partner._id),
                token: String(fcmToken).trim(),
                platform: platform === 'mobile' ? 'mobile' : 'web',
            });
        } catch (err) {
            logger.warn(`[FCM-Register] Delivery ${partner._id} upsert backup failed: ${err?.message || err}`);
        }
    }

    const tokenSnapshot = await FoodDeliveryPartner.findById(partner._id)
        .select('fcmTokens fcmTokenMobile')
        .lean();
    logger.info(
        `[FCM-Register] Delivery ${partner._id} saved tokens web=${tokenSnapshot?.fcmTokens?.length || 0} mobile=${tokenSnapshot?.fcmTokenMobile?.length || 0}`
    );

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        const joinRequestLink = '/admin/food/delivery-partners/join-request';
        const registrationEventKey = `new_registration:delivery_partner:${String(partner._id)}`;
        void notifyAdminsSafely({
            title: 'New Delivery Partner Registration 🚲',
            body: `A new delivery partner "${partner.name}" has signed up and is pending approval.`,
            link: joinRequestLink,
            idempotencyKey: registrationEventKey,
            data: {
                type: 'new_registration',
                subType: 'delivery_partner',
                id: String(partner._id)
            }
        });
        // notifyAdminsSafely also pushes a live copy to open admin panels.
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new delivery partner registration:', e);
    }

    try {
        if (partner.email) {
            const { sendDeliveryRegistrationReceivedEmail } = await import('../../../../utils/email.js');
            void sendDeliveryRegistrationReceivedEmail({
                to: partner.email,
                partnerName: partner.name,
                partnerId: String(partner._id),
                phone: partner.phone,
                vehicleType: partner.vehicleType,
                city: partner.city
            });
        }

        const { sendAdminAlertEmail } = await import('../../../../utils/email.js');
        void sendAdminAlertEmail({
            type: 'delivery_registration',
            subject: `New Delivery Partner Application: "${partner.name}"`,
            title: 'New Delivery Partner Application 🛵',
            message: `A new delivery partner "${partner.name}" has signed up and submitted documents for verification.`,
            details: [
                { label: 'Partner Name', value: partner.name },
                { label: 'Phone', value: partner.phone || '—' },
                { label: 'Email', value: partner.email || '—' },
                { label: 'Vehicle Type', value: partner.vehicleType || '—' },
                { label: 'Vehicle Number', value: partner.vehicleNumber || '—' },
                { label: 'City', value: partner.city || '—' },
                { label: 'Partner ID', value: String(partner._id) }
            ]
        });
    } catch (emailErr) {
        logger.warn(`[DeliveryRegister-Email] Email failed: ${emailErr?.message || emailErr}`);
    }

    return partner.toObject();
};

export const updateDeliveryPartnerProfile = async (userId, payload, files) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    const {
        name, email, countryCode, address, city, state, zoneId,
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber, panNumber, aadharNumber,
        fcmToken, platform
    } = payload;

    if (name) partner.name = name;
    if (email !== undefined) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (normalizedEmail) partner.email = normalizedEmail;
    }
    if (countryCode !== undefined) partner.countryCode = countryCode;
    if (address !== undefined) partner.address = address;
    if (city !== undefined) partner.city = city;
    if (state !== undefined) partner.state = state;
    if (zoneId !== undefined) {
        if (zoneId && mongoose.Types.ObjectId.isValid(String(zoneId))) {
            const z = await FoodZone.findById(zoneId).select('_id').lean();
            if (z) partner.zoneId = z._id;
        } else if (!zoneId) {
            partner.zoneId = null;
        }
    } else if (city !== undefined || address !== undefined || state !== undefined) {
        const autoZone = await resolveZoneIdForPartner({
            city: city ?? partner.city,
            address: address ?? partner.address,
            state: state ?? partner.state
        });
        if (autoZone) partner.zoneId = autoZone;
    }
    if (vehicleType !== undefined) partner.vehicleType = vehicleType;
    if (vehicleName !== undefined) partner.vehicleName = vehicleName;
    if (vehicleNumber !== undefined) partner.vehicleNumber = vehicleNumber;
    if (drivingLicenseNumber !== undefined) partner.drivingLicenseNumber = drivingLicenseNumber;

    if (fcmToken) {
        appendPartnerFcmToken(partner, fcmToken, platform);
    }

    // Every document photo sent to this endpoint is stored. Only profilePhoto used to
    // be handled, so Aadhar/PAN/licence uploads returned success but were discarded
    // and the old (or missing) document came back after a refresh.
    const previousDocUrls = {};
    for (const field of DELIVERY_DRAFT_FIELDS) {
        if (!files?.[field]?.[0]) continue;
        previousDocUrls[field] = partner[field];
        partner[field] = await uploadImageBuffer(files[field][0].buffer, DELIVERY_DOC_FOLDERS[field], { maxWidth: DELIVERY_DOC_MAX_WIDTH });
    }

    await partner.save();

    // Remove replaced files only once the new references are saved.
    await Promise.all(
        Object.entries(previousDocUrls).map(([field, previousUrl]) =>
            previousUrl && previousUrl !== partner[field]
                ? deleteReplacedAssets(previousUrl, partner[field]).catch((err) =>
                    logger.warn(`[DeliveryProfile] Failed to delete replaced ${field}: ${err?.message || err}`)
                )
                : null
        )
    );
    return {
        partner: partner.toObject(),
        requiresReapproval: false
    };
};

export const updateDeliveryPartnerDetails = async (userId, payload) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    if (payload?.zoneId !== undefined) {
        if (payload.zoneId && mongoose.Types.ObjectId.isValid(String(payload.zoneId))) {
            const z = await FoodZone.findById(payload.zoneId).select('_id').lean();
            if (z) partner.zoneId = z._id;
        } else if (!payload.zoneId) {
            partner.zoneId = null;
        }
    }

    const vehicle = payload?.vehicle;
    if (vehicle && typeof vehicle === 'object') {
        if (vehicle.number !== undefined) partner.vehicleNumber = String(vehicle.number || '').trim();
        if (vehicle.type !== undefined) partner.vehicleType = String(vehicle.type || '').trim();
        if (vehicle.brand !== undefined) partner.vehicleName = String(vehicle.brand || '').trim();
        if (vehicle.model !== undefined) partner.vehicleName = String(vehicle.model || '').trim();
    }

    if (payload?.profilePhoto !== undefined) {
        const nextPhoto = payload.profilePhoto ? String(payload.profilePhoto).trim() : '';
        await deleteReplacedAssets(partner.profilePhoto, nextPhoto);
        partner.profilePhoto = nextPhoto;
    }

    await partner.save();
    return partner.toObject();
};

export const updateDeliveryPartnerProfilePhotoBase64 = async (userId, payload) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    const base64 = payload?.base64;
    const mimeType = payload?.mimeType || 'image/jpeg';
    if (!base64 || typeof base64 !== 'string') {
        throw new ValidationError('base64 is required');
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || !buffer.length) {
        throw new ValidationError('Invalid base64 image');
    }
    if (buffer.length > 8 * 1024 * 1024) {
        throw new ValidationError('Image too large (max 8MB)');
    }
    // uploadImageBuffer expects raw bytes; mimeType is ignored by current implementation, but buffer is valid.
    partner.profilePhoto = await uploadImageBuffer(buffer, 'food/delivery/profile', {
        replaceUrl: partner.profilePhoto
    });
    await partner.save();
    return partner.toObject();
};

export const updateDeliveryPartnerBankDetails = async (userId, payload, files) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    // Handle both nested JSON and flat FormData from multer
    let bankDetails = payload?.documents?.bankDetails;
    let panDetails = payload?.documents?.pan;

    // Multer flattens FormData keys like 'documents[bankDetails][accountNumber]'
    if (!bankDetails && payload) {
        const b = {};
        if (payload['documents[bankDetails][accountHolderName]'] !== undefined) b.accountHolderName = payload['documents[bankDetails][accountHolderName]'];
        if (payload['documents[bankDetails][accountNumber]'] !== undefined) b.accountNumber = payload['documents[bankDetails][accountNumber]'];
        if (payload['documents[bankDetails][ifscCode]'] !== undefined) b.ifscCode = payload['documents[bankDetails][ifscCode]'];
        if (payload['documents[bankDetails][bankName]'] !== undefined) b.bankName = payload['documents[bankDetails][bankName]'];
        if (payload['documents[bankDetails][upiId]'] !== undefined) b.upiId = payload['documents[bankDetails][upiId]'];
        if (Object.keys(b).length > 0) bankDetails = b;
    }

    if (!panDetails && payload?.['documents[pan][number]'] !== undefined) {
        panDetails = { number: payload['documents[pan][number]'] };
    }

    if (bankDetails) {
        const b = bankDetails;
        if (b.accountHolderName !== undefined) partner.bankAccountHolderName = b.accountHolderName ? String(b.accountHolderName).trim() : '';
        if (b.accountNumber !== undefined) partner.bankAccountNumber = b.accountNumber ? String(b.accountNumber).trim() : '';
        if (b.ifscCode !== undefined) partner.bankIfscCode = b.ifscCode ? String(b.ifscCode).trim().toUpperCase() : '';
        if (b.bankName !== undefined) partner.bankName = b.bankName ? String(b.bankName).trim() : '';
        if (b.upiId !== undefined) partner.upiId = b.upiId ? String(b.upiId).trim() : '';
    }

    if (panDetails?.number !== undefined) {
        partner.panNumber = panDetails.number ? String(panDetails.number).trim().toUpperCase() : '';
    }

    const previousUpiQrCode = partner.upiQrCode;
    if (files?.upiQrCode?.[0]) {
        partner.upiQrCode = await uploadImageBuffer(files.upiQrCode[0].buffer, 'food/delivery/upi');
    } else if (bankDetails?.upiQrCode === '') {
        // Explicit removal of the saved UPI QR image.
        partner.upiQrCode = '';
    }

    await partner.save();

    // Delete the old QR file only after the new reference is saved, so a failed
    // save never leaves the profile pointing at a deleted image.
    if (previousUpiQrCode && previousUpiQrCode !== partner.upiQrCode) {
        await deleteReplacedAssets(previousUpiQrCode, partner.upiQrCode).catch((err) =>
            logger.warn(`[DeliveryBank] Failed to delete replaced UPI QR: ${err?.message || err}`)
        );
    }
    return partner.toObject();
};

function generateTicketId() {
    const n = Date.now().toString(36).slice(-6).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TKT-${n}${r}`;
}

export const listSupportTicketsByPartner = async (deliveryPartnerId) => {
    const list = await DeliverySupportTicket.find({ deliveryPartnerId })
        .sort({ createdAt: -1 })
        .lean();
    return list;
};

export const createSupportTicket = async (deliveryPartnerId, payload) => {
    const { subject, description, category = 'other', priority = 'medium' } = payload;
    if (!subject || !description || subject.trim().length < 3) {
        throw new ValidationError('Subject is required (min 3 characters)');
    }
    if (description.trim().length < 10) {
        throw new ValidationError('Description must be at least 10 characters');
    }
    let ticketId = generateTicketId();
    let exists = await DeliverySupportTicket.findOne({ ticketId }).lean();
    while (exists) {
        ticketId = generateTicketId();
        exists = await DeliverySupportTicket.findOne({ ticketId }).lean();
    }
    const ticket = await DeliverySupportTicket.create({
        deliveryPartnerId,
        ticketId,
        subject: subject.trim(),
        description: description.trim(),
        category: ['payment', 'account', 'technical', 'order', 'other'].includes(category) ? category : 'other',
        priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
        status: 'open'
    });
    return ticket.toObject();
};

export const getSupportTicketByIdAndPartner = async (ticketId, deliveryPartnerId) => {
    const ticket = await DeliverySupportTicket.findOne({
        _id: ticketId,
        deliveryPartnerId
    }).lean();
    return ticket;
};

export const updateDeliveryAvailability = async (userId, payload) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    const { status, latitude, longitude } = payload || {};
    let validStatus = 'offline';
    if (status === 'online' || status === true) validStatus = 'online';
    else if (status === 'offline' || status === false) validStatus = 'offline';
    
    partner.availabilityStatus = validStatus;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
        partner.lastLocation = {
            type: 'Point',
            coordinates: [longitude, latitude]
        };
        partner.lastLat = latitude;
        partner.lastLng = longitude;
        partner.lastLocationAt = new Date();
    }
    await partner.save();

    // The HTTP heartbeat is also a live-tracking transport: when the rider app is
    // backgrounded its socket drops, and the customer's bike used to freeze.
    if (typeof latitude === 'number' && typeof longitude === 'number') {
        try {
            const { publishRiderLocation } = await import('./riderLocation.service.js');
            await publishRiderLocation({
                deliveryPartnerId: userId,
                lat: latitude,
                lng: longitude,
                heading: payload?.heading,
                speed: payload?.speed,
                accuracy: payload?.accuracy,
                timestamp: payload?.timestamp,
                source: 'http',
            });
        } catch (err) {
            logger.warn(`[RiderLocation] HTTP publish failed for ${userId}: ${err?.message || err}`);
        }
    }

    return { availabilityStatus: partner.availabilityStatus };
};

// ----- Delivery partner wallet (Pocket / requests page) -----
export const getDeliveryPartnerWallet = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    // The rider's own zone limits (zone override, else the default).
    const cashLimitSettings = await getDeliveryCashLimitSettings({ zoneId: partner.zoneId });
    const totalCashLimit = Number(cashLimitSettings.deliveryCashLimit) || 0;
    const deliveryWithdrawalLimit = Number(cashLimitSettings.deliveryWithdrawalLimit) || 100;

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

    // Earnings paid to rider through completed deliveries
    const [earningsAgg, cashAgg] = await Promise.all([
        FoodOrder.aggregate([
            {
                $match: {
                    'dispatch.deliveryPartnerId': partnerId,
                    orderStatus: 'delivered',
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarned: { $sum: { $ifNull: ['$riderEarning', 0] } }
                }
            }
        ]),
        FoodOrder.aggregate([
            {
                $match: {
                    'dispatch.deliveryPartnerId': partnerId,
                    orderStatus: 'delivered',
                    'payment.method': 'cash',
                    'payment.status': 'paid'
                }
            },
            {
                $group: {
                    _id: null,
                    cashInHand: { $sum: { $ifNull: ['$riderEarning', 0] } }
                }
            }
        ])
    ]);

    const totalEarned = Number(earningsAgg?.[0]?.totalEarned) || 0;
    const cashInHand = Number(cashAgg?.[0]?.cashInHand) || 0;

    // Admin-set delivery bonuses / earning addons
    const bonusAgg = await DeliveryBonusTransaction.aggregate([
        { $match: { deliveryPartnerId: partnerId } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalBonus = bonusAgg?.[0] ? Number(bonusAgg[0].total) : 0;

    // Keep transactions list reasonably small (UI only needs recent data for charts)
    const [paymentTxList, bonusTxList] = await Promise.all([
        FoodOrder.find({
            'dispatch.deliveryPartnerId': partnerId,
            orderStatus: 'delivered',
        })
            .sort({ 'deliveryState.deliveredAt': -1, createdAt: -1 })
            .select('orderId riderEarning payment orderStatus deliveryState createdAt deliveryState.deliveredAt')
            .limit(2000)
            .lean(),
        DeliveryBonusTransaction.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(1000)
            .lean(),
    ]);

    const paymentTransactions = (paymentTxList || []).map((o) => {
        const deliveredAt = o?.deliveryState?.deliveredAt || o?.deliveredAt || null;
        const date = deliveredAt || o?.createdAt || new Date();
        return {
            _id: o._id,
            type: 'payment',
            amount: Number(o.riderEarning) || 0,
            status: 'Completed',
            date,
            createdAt: date,
            orderId: o.orderId || String(o._id),
            paymentMethod: o?.payment?.method || '',
            metadata: { orderId: o.orderId || String(o._id) },
            description: o?.payment?.method === 'cash' ? 'COD delivery earning' : 'Online delivery earning'
        };
    });

    // Frontend weekly earnings expects bonus transactions as `earning_addon`.
    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t._id,
        type: 'earning_addon',
        amount: Number(t.amount) || 0,
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus'
    }));

    const totalWithdrawn = 0;
    const totalBalance = totalEarned + totalBonus;
    const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);

    return {
        totalBalance,
        pocketBalance: totalBalance,
        cashInHand,
        totalWithdrawn,
        totalEarned,
        totalCashLimit,
        availableCashLimit,
        deliveryWithdrawalLimit,
        transactions: [...paymentTransactions, ...bonusTransactions].sort((a, b) => {
            const ad = a?.date ? new Date(a.date).getTime() : 0;
            const bd = b?.date ? new Date(b.date).getTime() : 0;
            return bd - ad;
        }),
        joiningBonusClaimed: false,
        joiningBonusAmount: 0
    };
};

// ----- Delivery partner earnings summary (Pocket / requests page) -----
export const getDeliveryPartnerEarnings = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const period = String(query.period || 'week').toLowerCase();
    const date = query.date ? new Date(query.date) : new Date();
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

    let range = null;
    if (period === 'today') {
        range = { start: toStartOfDay(date), end: toEndOfDay(date) };
    } else if (period === 'week') {
        range = getWeekRange(date);
    } else if (period === 'month') {
        range = getMonthRange(date);
    } else if (period === 'all') {
        range = null;
    } else {
        // fallback to week
        range = getWeekRange(date);
    }

    const match = {
        'dispatch.deliveryPartnerId': partnerId,
        orderStatus: 'delivered',
    };
    if (range) {
        // Prefer deliveredAt, but don't drop delivered orders that only have createdAt/updatedAt
        match.$or = [
            { 'deliveryState.deliveredAt': { $gte: range.start, $lte: range.end } },
            {
                $and: [
                    {
                        $or: [
                            { 'deliveryState.deliveredAt': { $exists: false } },
                            { 'deliveryState.deliveredAt': null },
                        ],
                    },
                    { updatedAt: { $gte: range.start, $lte: range.end } },
                ],
            },
            {
                $and: [
                    {
                        $or: [
                            { 'deliveryState.deliveredAt': { $exists: false } },
                            { 'deliveryState.deliveredAt': null },
                        ],
                    },
                    { createdAt: { $gte: range.start, $lte: range.end } },
                ],
            },
        ];
    }

    const [totalOrders, agg, bonusAgg] = await Promise.all([
        FoodOrder.countDocuments(match),
        FoodOrder.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: { $ifNull: ['$riderEarning', 0] } }
                }
            }
        ]),
        range
            ? DeliveryBonusTransaction.aggregate([
                {
                    $match: {
                        deliveryPartnerId: partnerId,
                        createdAt: { $gte: range.start, $lte: range.end },
                    },
                },
                { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
            ])
            : DeliveryBonusTransaction.aggregate([
                { $match: { deliveryPartnerId: partnerId } },
                { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } },
            ]),
    ]);

    const totalEarnings = Number(agg?.[0]?.totalEarnings) || 0;
    const totalBonus = Number(bonusAgg?.[0]?.total) || 0;

    // Weekly "Earnings" card = order earnings only.
    // Admin/referral/addon bonuses stay in pocket balance (not mixed into this card).
    const summary = {
        totalEarnings,
        totalOrders,
        totalHours: 0,
        totalMinutes: 0,
        orderEarning: totalEarnings,
        incentive: totalBonus,
        otherEarnings: totalBonus,
    };

    return {
        summary,
        period,
        date: date.toISOString(),
        pagination: { page, limit, total: totalOrders }
    };
};

const normalizeStatusFilter = (status) => {
    if (!status) return null;
    const s = String(status || '').trim();
    if (!s || s.toUpperCase() === 'ALL TRIPS') return null;
    // UI uses Completed/Cancelled/Pending
    return s;
};

const toStartOfDay = (d) => toStartOfDayInTimeZone(d);
const toEndOfDay = (d) => toEndOfDayInTimeZone(d);
const getWeekRange = (anchorDate) => getWeekRangeInTimeZone(anchorDate);
const getMonthRange = (anchorDate) => getMonthRangeInTimeZone(anchorDate);

const formatTripTimeIST = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Always Asia/Kolkata — never depend on server OS timezone
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: APP_TIMEZONE,
  });
};

const computeRange = (period, date) => {
  const p = String(period || 'daily').toLowerCase();
  const anchor = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  if (p === 'weekly' || p === 'week') return getWeekRange(anchor);
  if (p === 'monthly' || p === 'month') return getMonthRange(anchor);
  // daily
  return { start: toStartOfDay(anchor), end: toEndOfDay(anchor) };
};

const toTripDto = (order) => {
  const createdAt = order?.createdAt || null;
  const deliveredAt = order?.deliveryState?.deliveredAt || order?.deliveredAt || order?.completedAt || null;
  // Match admin "ORDER DATE" semantics for the Time column: order placed time.
  // (Delivered time is still exposed separately as deliveredAt for clients that need it.)
  const dateForUi = createdAt || deliveredAt || order?.updatedAt || null;

  const time = formatTripTimeIST(dateForUi);

  const orderStatus = String(order?.orderStatus || order?.status || '').toLowerCase();
  const isDelivered = orderStatus === 'delivered' || String(order?.deliveryState?.currentPhase || '').toLowerCase() === 'delivered';
  const isCancelled = orderStatus.startsWith('cancelled') || String(order?.deliveryState?.status || '').toLowerCase().includes('cancel');

  const status = isDelivered ? 'Completed' : isCancelled ? 'Cancelled' : 'Pending';

  const restaurantName =
    order?.restaurantId?.restaurantName ||
    order?.restaurantName ||
    order?.restaurant?.restaurantName ||
    '';

  const paymentMethod = String(order?.payment?.method || order?.paymentMethod || '').toLowerCase();
  const pricingTotal = Number(order?.pricing?.total) || Number(order?.totalAmount) || 0;

  const earningAmount = Number(order?.riderEarning ?? order?.deliveryEarning ?? 0) || 0;
  const isCashCod =
    paymentMethod === 'cash' ||
    paymentMethod === 'cod' ||
    paymentMethod === 'cash on delivery';
  const amountDue = Number(order?.payment?.amountDue);
  const codAmount = isCashCod
    ? (Number.isFinite(amountDue) && amountDue > 0 ? amountDue : pricingTotal)
    : 0;
  const paymentStatus = String(order?.payment?.status || '').toLowerCase();
  const codCollectedAmount =
    isCashCod && (paymentStatus === 'paid' || isDelivered) ? codAmount : 0;
  return {
    id: order?._id,
    _id: order?._id,
    orderId: order?.orderId || order?._id,
    status,
    restaurantName,
    restaurant: restaurantName,
    // The rider's bill is the customer's; the restaurant/platform split is not theirs to see.
    items: stripDeliveryPricingInternals({ items: order?.items || order?.orderItems || [] }).items,
    orderItems: stripDeliveryPricingInternals({ items: order?.orderItems || order?.items || [] }).items,
    paymentMethod,
    totalAmount: pricingTotal,
    orderTotal: pricingTotal,
    codAmount: codAmount,
    codCollectedAmount,
    deliveryEarning: earningAmount,
    earningAmount: earningAmount,
    amount: earningAmount, // legacy fallback
    baseEarningAmount:
      order?.riderBaseEarning != null ? Number(order.riderBaseEarning) || 0 : earningAmount,
    eatiefyIncentiveAmount: Number(order?.eatiefyIncentive?.amount || 0) || 0,
    eatiefyIncentivePercent: Number(order?.eatiefyIncentive?.percent || 0) || 0,
    createdAt: order?.createdAt,
    deliveredAt: deliveredAt,
    completedAt: deliveredAt,
    date: dateForUi,
    time,
    timeZone: APP_TIMEZONE,
  };
};

export const getDeliveryPartnerTripHistory = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const period = query.period || 'daily';
    const date = query.date ? new Date(query.date) : new Date();
    const statusFilter = normalizeStatusFilter(query.status);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);

    const { start, end } = computeRange(period, date);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const match = { 'dispatch.deliveryPartnerId': partnerId };

    const sf = String(statusFilter || '').toLowerCase();
    if (sf === 'completed') {
        // Same day axis as ALL TRIPS (order placed / createdAt) so Completed ⊆ ALL
        // for that day. Using deliveredAt here dropped orders placed yesterday but
        // delivered next day (or missing deliveredAt), which made COD/earnings smaller.
        match.orderStatus = 'delivered';
        match.createdAt = { $gte: start, $lte: end };
    } else if (sf === 'cancelled') {
        match.orderStatus = { $regex: '^cancelled', $options: 'i' };
        match.createdAt = { $gte: start, $lte: end };
    } else if (sf === 'pending') {
        match.createdAt = { $gte: start, $lte: end };
        // Pending = not delivered and not cancelled
        match.$and = [
            { orderStatus: { $ne: 'delivered' } },
            { orderStatus: { $not: { $regex: '^cancelled', $options: 'i' } } },
        ];
    } else {
        // ALL TRIPS: show anything created in range
        match.createdAt = { $gte: start, $lte: end };
    }

    const orders = await FoodOrder.find(match)
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    // Sort by each trip's effective time (delivered time for completed, else placed
    // time) descending — latest order on top regardless of status (pending/completed).
    const trips = (orders || [])
        .map(toTripDto)
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return {
        period,
        date: (date || new Date()).toISOString(),
        range: { start: start.toISOString(), end: end.toISOString() },
        trips
    };
};

// Reviews given by customers to the logged-in delivery partner.
export const getDeliveryPartnerReviews = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const filter = {
        'dispatch.deliveryPartnerId': partnerId,
        'ratings.deliveryPartner.rating': { $exists: true, $ne: null },
    };

    const [docs, total, agg] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name')
            .select('orderId userId ratings.deliveryPartner createdAt deliveryState.deliveredAt')
            .lean(),
        FoodOrder.countDocuments(filter),
        // Compute the average from the actual delivery ratings on orders so the number
        // always matches the reviews shown here (the partner.rating aggregate field can
        // drift from real data, e.g. due to old/test ratings).
        FoodOrder.aggregate([
            { $match: filter },
            { $group: { _id: null, avg: { $avg: '$ratings.deliveryPartner.rating' }, count: { $sum: 1 } } },
        ]),
    ]);

    const reviews = docs.map((doc) => ({
        orderId: doc.orderId,
        customer: doc.userId?.name || 'Customer',
        review: doc.ratings?.deliveryPartner?.comment || '',
        rating: doc.ratings?.deliveryPartner?.rating || 0,
        submittedAt: doc.createdAt,
        deliveredAt: doc.deliveryState?.deliveredAt || null,
    }));

    const averageRating = agg?.[0]?.avg ? Math.round(agg[0].avg * 10) / 10 : 0;
    const totalRatings = agg?.[0]?.count || total;

    return { reviews, total, page, limit, averageRating, totalRatings };
};

export const getDeliveryPocketDetails = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const date = query.date ? new Date(query.date) : new Date();
    const { start, end } = getWeekRange(date);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 2000);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

    const orders = await FoodOrder.find({
        'dispatch.deliveryPartnerId': partnerId,
        orderStatus: 'delivered',
        $or: [
            { 'deliveryState.deliveredAt': { $gte: start, $lte: end } },
            { deliveredAt: { $gte: start, $lte: end } },
            { completedAt: { $gte: start, $lte: end } },
            { updatedAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } }
        ]
    })
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .sort({ 'deliveryState.deliveredAt': -1, deliveredAt: -1, completedAt: -1, updatedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean();

    const bonusTxList = await DeliveryBonusTransaction.find({
        deliveryPartnerId: partnerId,
        createdAt: { $gte: start, $lte: end }
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    const trips = (orders || []).map(toTripDto);

    const paymentTransactions = (orders || []).map((o) => ({
        _id: o._id,
        type: 'payment',
        amount: Number(o.riderEarning) || 0,
        status: 'Completed',
        date: o?.deliveryState?.deliveredAt || o?.deliveredAt || o?.createdAt,
        createdAt: o?.deliveryState?.deliveredAt || o?.deliveredAt || o?.createdAt,
        orderId: o.orderId || String(o._id),
        metadata: { orderId: o.orderId || String(o._id) },
        description: o?.restaurantId?.restaurantName ? `Order earning - ${o.restaurantId.restaurantName}` : 'Order earning'
    }));

    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t._id,
        type: 'bonus',
        amount: Number(t.amount) || 0,
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus'
    }));

    const totalEarning = paymentTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalBonus = bonusTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return {
        week: { start: start.toISOString(), end: end.toISOString() },
        summary: { totalEarning, totalBonus, grandTotal: totalEarning + totalBonus },
        trips,
        transactions: {
            payment: paymentTransactions,
            bonus: bonusTransactions
        }
    };
};

export const getActiveEarningAddonsForPartner = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const now = new Date();

    // Offers for every zone, plus the ones for this rider's own zone.
    const partner = await FoodDeliveryPartner.findById(partnerId).select('zoneId').lean();
    const zoneScope = partner?.zoneId
        ? { $or: [{ zoneId: null }, { zoneId: partner.zoneId }] }
        : { zoneId: null };

    const addons = await FoodEarningAddon.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
        ...zoneScope
    })
        .sort({ endDate: 1, createdAt: 1 })
        .lean();

    const liveAddons = (addons || []).filter((addon) => {
        if (!addon) return false;
        const maxRedemptions = Number(addon.maxRedemptions);
        if (!Number.isFinite(maxRedemptions) || maxRedemptions <= 0) return true;
        return Number(addon.currentRedemptions || 0) < maxRedemptions;
    });

    const offers = await Promise.all(
        liveAddons.map(async (addon) => {
            const startDate = addon.startDate ? new Date(addon.startDate) : null;
            const endDate = addon.endDate ? new Date(addon.endDate) : null;

            const baseMatch = {
                'dispatch.deliveryPartnerId': partnerId,
                orderStatus: 'delivered'
            };

            if (startDate && endDate) {
                baseMatch['deliveryState.deliveredAt'] = { $gte: startDate, $lte: endDate };
            }

            const [currentOrders, earningsAgg] = await Promise.all([
                FoodOrder.countDocuments(baseMatch),
                FoodOrder.aggregate([
                    { $match: baseMatch },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: { $ifNull: ['$riderEarning', 0] } }
                        }
                    }
                ])
            ]);

            const currentEarnings = Number(earningsAgg?.[0]?.total) || 0;

            return {
                id: addon._id,
                title: addon.title || 'Earnings Guarantee',
                description: addon.description || '',
                targetAmount: Number(addon.earningAmount) || 0,
                targetOrders: Number(addon.requiredOrders) || 0,
                currentOrders: Number(currentOrders) || 0,
                currentEarnings,
                startDate,
                endDate,
                validTill: endDate ? endDate.toISOString() : null,
                isLive: true
            };
        })
    );

    return {
        activeOffer: offers[0] || null,
        offers
    };
};

