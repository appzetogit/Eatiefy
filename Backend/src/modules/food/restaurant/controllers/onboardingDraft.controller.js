import { sendResponse } from '../../../../utils/response.js';
import {
    getOnboardingDraftUploads,
    addOnboardingDraftUpload,
    removeOnboardingDraftUpload,
    clearOnboardingDraftUploads
} from '../services/onboardingDraft.service.js';

export const getOnboardingDraftUploadsController = async (req, res, next) => {
    try {
        const uploads = await getOnboardingDraftUploads(req.registration.phoneLast10);
        return sendResponse(res, 200, 'Onboarding uploads fetched successfully', { uploads });
    } catch (error) {
        next(error);
    }
};

export const addOnboardingDraftUploadController = async (req, res, next) => {
    try {
        const result = await addOnboardingDraftUpload(
            req.registration.phoneLast10,
            req.body?.field,
            req.file
        );
        return sendResponse(res, 201, 'File uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const removeOnboardingDraftUploadController = async (req, res, next) => {
    try {
        const isClearAll = req.body?.clearAll ?? req.query?.clearAll;
        if (
            isClearAll === true ||
            isClearAll === 'true' ||
            (!req.body?.field && !req.query?.field && !req.body?.url && !req.query?.url)
        ) {
            const uploads = await clearOnboardingDraftUploads(req.registration.phoneLast10);
            return sendResponse(res, 200, 'All draft uploads removed successfully', { uploads });
        }
        const uploads = await removeOnboardingDraftUpload(
            req.registration.phoneLast10,
            req.body?.field ?? req.query?.field,
            req.body?.url ?? req.query?.url
        );
        return sendResponse(res, 200, 'File removed successfully', { uploads });
    } catch (error) {
        next(error);
    }
};
