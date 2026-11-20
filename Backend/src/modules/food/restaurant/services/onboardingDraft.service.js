import { FoodRestaurantOnboardingDraft, ONBOARDING_DRAFT_TTL_DAYS } from '../models/onboardingDraft.model.js';
import { storeImageBuffer, deleteStoredAsset, extractAssetUrl, extractAssetUrls } from '../../../../services/storage.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

export const MAX_DRAFT_MENU_IMAGES = 10;

/** Same storage folders the multipart /register endpoint uses. */
const FIELD_FOLDERS = {
    profileImage: 'food/restaurants/profile',
    menuImages: 'food/restaurants/menu',
    panImage: 'food/restaurants/pan',
    gstImage: 'food/restaurants/gst',
    fssaiImage: 'food/restaurants/fssai'
};

export const DRAFT_UPLOAD_FIELDS = Object.keys(FIELD_FOLDERS);

const nextExpiry = () => new Date(Date.now() + ONBOARDING_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000);

const assertField = (field) => {
    const value = String(field || '').trim();
    if (!DRAFT_UPLOAD_FIELDS.includes(value)) {
        throw new ValidationError(`Invalid upload field. Allowed: ${DRAFT_UPLOAD_FIELDS.join(', ')}`);
    }
    return value;
};

const toUploadsPayload = (doc) => {
    const uploads = doc?.uploads || {};
    return {
        profileImage: uploads.profileImage || '',
        menuImages: Array.isArray(uploads.menuImages) ? uploads.menuImages.filter(Boolean) : [],
        panImage: uploads.panImage || '',
        gstImage: uploads.gstImage || '',
        fssaiImage: uploads.fssaiImage || ''
    };
};

const safeDelete = async (url) => {
    if (!url) return;
    try {
        await deleteStoredAsset(url);
    } catch (err) {
        logger.warn(`[OnboardingDraft] Failed to delete replaced asset ${url}: ${err?.message || err}`);
    }
};

export const getOnboardingDraftUploads = async (phoneLast10) => {
    const doc = await FoodRestaurantOnboardingDraft.findOne({ phoneLast10 }).lean();
    return toUploadsPayload(doc);
};

/**
 * Stores one onboarding image and records its URL in the phone's draft.
 * Single-image fields replace (and delete) the previous file; menu images append.
 */
export const addOnboardingDraftUpload = async (phoneLast10, rawField, file) => {
    const field = assertField(rawField);
    if (!file?.buffer?.length) {
        throw new ValidationError('No file uploaded');
    }

    if (field === 'menuImages') {
        const existing = await FoodRestaurantOnboardingDraft.findOne({ phoneLast10 })
            .select('uploads.menuImages')
            .lean();
        if ((existing?.uploads?.menuImages?.length || 0) >= MAX_DRAFT_MENU_IMAGES) {
            throw new ValidationError(`You can upload up to ${MAX_DRAFT_MENU_IMAGES} menu images`);
        }
    }

    const stored = await storeImageBuffer(file.buffer, FIELD_FOLDERS[field], {
        originalName: file.originalname,
        mimeType: file.mimetype
    });
    const url = stored.url || stored.secure_url;
    if (!url) {
        throw new ValidationError('Upload failed: storage returned no URL');
    }

    if (field === 'menuImages') {
        await FoodRestaurantOnboardingDraft.updateOne(
            { phoneLast10 },
            { $set: { expiresAt: nextExpiry() } },
            { upsert: true }
        );
        // The array-size guard in the filter keeps two parallel uploads from
        // pushing the draft past the limit.
        const pushed = await FoodRestaurantOnboardingDraft.findOneAndUpdate(
            { phoneLast10, [`uploads.menuImages.${MAX_DRAFT_MENU_IMAGES - 1}`]: { $exists: false } },
            { $push: { 'uploads.menuImages': url }, $set: { expiresAt: nextExpiry() } },
            { new: true }
        ).lean();
        if (!pushed) {
            await safeDelete(url);
            throw new ValidationError(`You can upload up to ${MAX_DRAFT_MENU_IMAGES} menu images`);
        }
        return { url, publicId: stored.public_id || null, field, uploads: toUploadsPayload(pushed) };
    }

    const previous = await FoodRestaurantOnboardingDraft.findOneAndUpdate(
        { phoneLast10 },
        { $set: { [`uploads.${field}`]: url, expiresAt: nextExpiry() } },
        { upsert: true, new: false }
    ).lean();
    const previousUrl = previous?.uploads?.[field];
    if (previousUrl && previousUrl !== url) {
        await safeDelete(previousUrl);
    }

    const current = await FoodRestaurantOnboardingDraft.findOne({ phoneLast10 }).lean();
    return { url, publicId: stored.public_id || null, field, uploads: toUploadsPayload(current) };
};

/** Removes one uploaded image. Only files recorded in this phone's draft are ever deleted. */
export const removeOnboardingDraftUpload = async (phoneLast10, rawField, rawUrl) => {
    const field = assertField(rawField);
    const url = extractAssetUrl(rawUrl);
    if (!url) {
        throw new ValidationError('Image url is required');
    }

    const filter = field === 'menuImages'
        ? { phoneLast10, 'uploads.menuImages': url }
        : { phoneLast10, [`uploads.${field}`]: url };
    const update = field === 'menuImages'
        ? { $pull: { 'uploads.menuImages': url } }
        : { $set: { [`uploads.${field}`]: '' } };

    const updated = await FoodRestaurantOnboardingDraft.findOneAndUpdate(filter, update, { new: true }).lean();
    if (updated) {
        await safeDelete(url);
        return toUploadsPayload(updated);
    }
    return getOnboardingDraftUploads(phoneLast10);
};

const parseUrlList = (value) => {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return extractAssetUrls(value);
    const raw = String(value).trim();
    if (raw.startsWith('[')) {
        try {
            return extractAssetUrls(JSON.parse(raw));
        } catch {
            return [];
        }
    }
    return extractAssetUrls(raw.split(',').map((part) => part.trim()));
};

/**
 * Resolves the pre-uploaded image URLs a /register submission references.
 * A URL is honoured only when it is recorded in the draft for that owner phone,
 * so a submission can never attach arbitrary external or foreign files.
 */
export const resolveDraftImagesForRegistration = async (phoneLast10, body = {}) => {
    const empty = { profileImage: '', panImage: '', gstImage: '', fssaiImage: '', menuImages: [] };
    if (!phoneLast10) return empty;

    const requested = {
        profileImage: extractAssetUrl(body.profileImageUrl),
        panImage: extractAssetUrl(body.panImageUrl),
        gstImage: extractAssetUrl(body.gstImageUrl),
        fssaiImage: extractAssetUrl(body.fssaiImageUrl),
        menuImages: parseUrlList(body.menuImageUrls)
    };
    const hasAnyRequest = Object.values(requested).some((v) => (Array.isArray(v) ? v.length : Boolean(v)));
    if (!hasAnyRequest) return empty;

    const draft = await getOnboardingDraftUploads(phoneLast10);
    const allowedMenu = new Set(draft.menuImages);

    const labels = {
        profileImage: 'restaurant profile image',
        panImage: 'PAN image',
        gstImage: 'GST image',
        fssaiImage: 'FSSAI image'
    };
    const resolved = { menuImages: [] };
    for (const field of Object.keys(labels)) {
        const url = requested[field];
        if (!url) {
            resolved[field] = '';
            continue;
        }
        // Silently dropping an unknown URL would register the restaurant without a
        // required document, so ask the partner to upload it again instead.
        if (url !== draft[field]) {
            throw new ValidationError(`Your uploaded ${labels[field]} is no longer available. Please upload it again.`);
        }
        resolved[field] = url;
    }
    if (requested.menuImages.some((url) => !allowedMenu.has(url))) {
        throw new ValidationError('Some uploaded menu images are no longer available. Please remove them and upload again.');
    }
    resolved.menuImages = requested.menuImages;

    return resolved;
};

/** Drops the draft after a successful registration. Files stay: the restaurant now references them. */
export const clearOnboardingDraft = async (phoneLast10) => {
    if (!phoneLast10) return;
    try {
        await FoodRestaurantOnboardingDraft.deleteOne({ phoneLast10 });
    } catch (err) {
        logger.warn(`[OnboardingDraft] Failed to clear draft for ${phoneLast10}: ${err?.message || err}`);
    }
};

/** Deletes all stored files and clears the draft uploads completely when onboarding is abandoned/logged out. */
export const clearOnboardingDraftUploads = async (phoneLast10) => {
    const emptyPayload = { profileImage: '', menuImages: [], panImage: '', gstImage: '', fssaiImage: '' };
    if (!phoneLast10) return emptyPayload;
    try {
        const doc = await FoodRestaurantOnboardingDraft.findOne({ phoneLast10 }).lean();
        if (doc?.uploads) {
            if (doc.uploads.profileImage) await safeDelete(doc.uploads.profileImage);
            if (doc.uploads.panImage) await safeDelete(doc.uploads.panImage);
            if (doc.uploads.gstImage) await safeDelete(doc.uploads.gstImage);
            if (doc.uploads.fssaiImage) await safeDelete(doc.uploads.fssaiImage);
            if (Array.isArray(doc.uploads.menuImages)) {
                for (const url of doc.uploads.menuImages) {
                    await safeDelete(url);
                }
            }
        }
        await FoodRestaurantOnboardingDraft.deleteOne({ phoneLast10 });
    } catch (err) {
        logger.warn(`[OnboardingDraft] Failed to clear all draft uploads for ${phoneLast10}: ${err?.message || err}`);
    }
    return emptyPayload;
};
