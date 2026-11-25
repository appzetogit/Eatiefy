import mongoose from 'mongoose';
import { registerDeliveryPartner, updateDeliveryPartnerProfile, updateDeliveryPartnerBankDetails, listSupportTicketsByPartner, createSupportTicket, getSupportTicketByIdAndPartner, updateDeliveryPartnerDetails, updateDeliveryPartnerProfilePhotoBase64, updateDeliveryAvailability, getDeliveryPartnerWallet, getDeliveryPartnerEarnings, getDeliveryPartnerTripHistory, getDeliveryPocketDetails, getActiveEarningAddonsForPartner, getDeliveryPartnerReviews } from '../services/delivery.service.js';
import { createDeliveryCashDepositOrder, getDeliveryPartnerWalletEnhanced, requestDeliveryWithdrawal, verifyDeliveryCashDepositPayment, submitCashDepositByHand } from '../services/deliveryFinance.service.js';
import {
    resolveDeliveryCashLimitForPartner,
    resolveDeliveryEmergencyHelpForPartner,
} from '../../admin/services/zoneDeliverySettings.service.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { validateDeliveryRegisterDto, validateDeliveryProfileUpdateDto, validateDeliveryBankDetailsDto } from '../validators/delivery.validator.js';
import { sendResponse } from '../../../../utils/response.js';
import { findDeliveryPartnerByPhone } from '../services/delivery.service.js';
import { getDeliveryReferralStats } from '../services/deliveryReferral.service.js';
import {
    DELIVERY_DRAFT_FIELDS,
    getDeliveryDraftUploads,
    addDeliveryDraftUpload,
    removeDeliveryDraftUpload
} from '../services/deliveryOnboardingDraft.service.js';

/**
 * Public, phone-keyed approval status for the "verification pending" screen.
 *
 * A pending partner has no session, and no push token either when the device
 * could not produce one, so without this the partner never learned they had
 * been approved. Returns the status only - no tokens, no profile data - so a
 * phone number reveals nothing beyond approved / pending / rejected. Signing
 * in still needs the OTP.
 */
export const getDeliveryVerificationStatusController = async (req, res, next) => {
    try {
        const partner = await findDeliveryPartnerByPhone(req.query.phone);
        if (!partner) {
            return sendResponse(res, 200, 'Delivery partner registration not found', { status: 'not_found' });
        }
        const status = String(partner.status || 'pending').toLowerCase();
        return sendResponse(res, 200, 'Status fetched successfully', {
            status,
            ...(status === 'rejected' ? { rejectionReason: partner.rejectionReason || null } : {}),
            ...(status === 'approved' ? { needsLogin: true } : {}),
        });
    } catch (error) {
        next(error);
    }
};

export const getDeliveryDraftUploadsController = async (req, res, next) => {
    try {
        const uploads = await getDeliveryDraftUploads(req.registration.phoneLast10);
        return sendResponse(res, 200, 'Signup documents fetched successfully', { uploads });
    } catch (error) {
        next(error);
    }
};

export const addDeliveryDraftUploadController = async (req, res, next) => {
    try {
        const result = await addDeliveryDraftUpload(req.registration.phoneLast10, req.body?.field, req.file);
        return sendResponse(res, 201, 'Document uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const removeDeliveryDraftUploadController = async (req, res, next) => {
    try {
        const uploads = await removeDeliveryDraftUpload(
            req.registration.phoneLast10,
            req.body?.field ?? req.query?.field,
            req.body?.url ?? req.query?.url
        );
        return sendResponse(res, 200, 'Document removed successfully', { uploads });
    } catch (error) {
        next(error);
    }
};

export const registerDeliveryPartnerController = async (req, res, next) => {
    try {
        const validated = validateDeliveryRegisterDto(req.body);
        // Photos uploaded earlier through the signup draft arrive as `<field>Url`
        // (the DTO strips unknown keys, so they are passed separately).
        const draftImageRefs = DELIVERY_DRAFT_FIELDS.reduce((acc, field) => {
            acc[`${field}Url`] = req.body?.[`${field}Url`];
            return acc;
        }, {});
        const partner = await registerDeliveryPartner(validated, req.files, draftImageRefs);
        return sendResponse(res, 201, 'Delivery partner registered successfully', partner);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfileController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryProfileUpdateDto(req.body);
        const result = await updateDeliveryPartnerProfile(userId, validated, req.files);
        return sendResponse(res, 200, 'Profile updated successfully', result);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerDetails(userId, req.body || {});
        return sendResponse(res, 200, 'Profile updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfilePhotoBase64Controller = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerProfilePhotoBase64(userId, req.body || {});
        return sendResponse(res, 200, 'Profile photo updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerBankDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryBankDetailsDto(req.body);
        const partner = await updateDeliveryPartnerBankDetails(userId, validated, req.files);
        const data = {
            bankDetails: {
                accountHolderName: partner.bankAccountHolderName,
                accountNumber: partner.bankAccountNumber,
                ifscCode: partner.bankIfscCode,
                bankName: partner.bankName,
                upiId: partner.upiId,
                upiQrCode: partner.upiQrCode
            },
            panNumber: partner.panNumber
        };
        return sendResponse(res, 200, 'Bank details updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listSupportTicketsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const tickets = await listSupportTicketsByPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Tickets fetched successfully', { tickets });
    } catch (error) {
        next(error);
    }
};

export const createSupportTicketController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await createSupportTicket(deliveryPartnerId, req.body);
        return sendResponse(res, 201, 'Ticket created successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const getSupportTicketByIdController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await getSupportTicketByIdAndPartner(req.params.id, deliveryPartnerId);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        return sendResponse(res, 200, 'Ticket fetched successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const updateAvailabilityController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await updateDeliveryAvailability(userId, req.body || {});
        return sendResponse(res, 200, 'Availability updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getWalletController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const requestedTypeRaw = String(req.query?.type || '').trim().toLowerCase();
        const rawLimit = Number.parseInt(String(req.query?.limit || ''), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

        const normalizeWalletTransaction = (tx) => ({
            ...tx,
            id: tx?.id || tx?._id,
            _id: tx?._id || tx?.id,
            amount: Number(tx?.amount) || 0,
            date: tx?.date || tx?.createdAt,
            createdAt: tx?.createdAt || tx?.date
        });

        if (
            requestedTypeRaw === 'bonus' ||
            requestedTypeRaw === 'deposit' ||
            requestedTypeRaw === 'deduction' ||
            requestedTypeRaw === 'withdrawal' ||
            requestedTypeRaw === 'payment'
        ) {
            if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
                return sendResponse(res, 200, 'Wallet fetched successfully', { wallet: { transactions: [] } });
            }

            const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
            if (requestedTypeRaw === 'bonus') {
                const bonusList = await DeliveryBonusTransaction.find({ deliveryPartnerId })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .lean();

                wallet.transactions = (bonusList || []).map((b) => ({
                    id: b._id,
                    _id: b._id,
                    type: 'bonus',
                    amount: b.amount || 0,
                    status: 'Completed',
                    date: b.createdAt,
                    createdAt: b.createdAt,
                    description: b.reference || 'Bonus',
                    transactionId: b.transactionId
                }));
            } else {
                const allowedTypes =
                    requestedTypeRaw === 'deposit'
                        ? new Set(['deposit'])
                        : requestedTypeRaw === 'deduction'
                          ? new Set(['withdrawal', 'deposit'])
                          : new Set([requestedTypeRaw]);

                // Withdrawals and deposits are read straight from their own
                // collections. Filtering the wallet's merged feed instead meant
                // the type filter ran *after* that feed had already been cut to
                // its newest 50 rows across every type — so a payout could be
                // pushed out by delivery earnings and vanish from history.
                const directRows = [];

                if (allowedTypes.has('withdrawal')) {
                    const withdrawals = await FoodDeliveryWithdrawal.find({ deliveryPartnerId })
                        .sort({ createdAt: -1 })
                        .limit(limit)
                        .lean();
                    directRows.push(
                        ...(withdrawals || []).map((w) => ({
                            id: w._id,
                            _id: w._id,
                            type: 'withdrawal',
                            amount: w.amount,
                            status:
                                w.status === 'pending'
                                    ? 'Pending'
                                    : w.status === 'approved'
                                      ? 'Completed'
                                      : 'Rejected',
                            date: w.createdAt,
                            createdAt: w.createdAt,
                            processedAt: w.processedAt || null,
                            failureReason: w.rejectionReason || null,
                            transactionId: w.transactionId || null,
                            description: `Withdrawal Request - ${w.paymentMethod}`,
                            payoutMethod: w.paymentMethod
                        }))
                    );
                }

                if (allowedTypes.has('deposit')) {
                    const deposits = await FoodDeliveryCashDeposit.find({ deliveryPartnerId })
                        .sort({ createdAt: -1 })
                        .limit(limit)
                        .lean();
                    directRows.push(
                        ...(deposits || []).map((d) => ({
                            id: d._id,
                            _id: d._id,
                            type: 'deposit',
                            amount: d.amount,
                            status: d.status || 'Pending',
                            date: d.createdAt,
                            createdAt: d.createdAt,
                            description: 'Cash limit settlement',
                            paymentMethod: d.paymentMethod || 'cash',
                            razorpayPaymentId: d.razorpayPaymentId || '',
                            razorpayOrderId: d.razorpayOrderId || ''
                        }))
                    );
                }

                if (directRows.length || allowedTypes.has('withdrawal') || allowedTypes.has('deposit')) {
                    wallet.transactions = directRows
                        .map(normalizeWalletTransaction)
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .slice(0, limit);
                } else {
                    wallet.transactions = (wallet.transactions || [])
                        .filter((tx) => allowedTypes.has(String(tx?.type || '').trim().toLowerCase()))
                        .map(normalizeWalletTransaction)
                        .slice(0, limit);
                }
            }

            return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
        }

        const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
        return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
    } catch (error) {
        next(error);
    }
};

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const result = await requestDeliveryWithdrawal(deliveryPartnerId, req.body || {});
        return sendResponse(res, 201, 'Withdrawal request submitted successfully', { withdrawal: result });
    } catch (error) {
        next(error);
    }
};

export const getEarningsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerEarnings(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Earnings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getActiveEarningAddonsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getActiveEarningAddonsForPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Active earning addons fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createCashDepositOrderController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await createDeliveryCashDepositOrder(deliveryPartnerId, amount);
        return sendResponse(res, 201, 'Cash deposit order created successfully', data);
    } catch (error) {
        next(error);
    }
};

export const verifyCashDepositPaymentController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await verifyDeliveryCashDepositPayment(deliveryPartnerId, {
            razorpayOrderId: req.body?.razorpay_order_id,
            razorpayPaymentId: req.body?.razorpay_payment_id,
            razorpaySignature: req.body?.razorpay_signature,
            amount: req.body?.amount
        });
        return sendResponse(res, 200, 'Cash deposit verified successfully', data);
    } catch (error) {
        next(error);
    }
};

export const submitCashDepositByHandController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await submitCashDepositByHand(deliveryPartnerId, amount);
        return sendResponse(res, 201, 'Cash submitted successfully. Waiting for admin confirmation.', data);
    } catch (error) {
        next(error);
    }
};

export const getTripHistoryController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerTripHistory(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Trip history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPocketDetailsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPocketDetails(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Pocket details fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getMyReviewsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerReviews(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Reviews fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getEmergencyHelpController = async (req, res, next) => {
    try {
        // The numbers of the rider's own zone (zone override, else the default).
        const data = await resolveDeliveryEmergencyHelpForPartner(req.user?.userId);
        return sendResponse(res, 200, 'Emergency help fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getCashLimitController = async (req, res, next) => {
    try {
        // The rider's own zone limits (zone override, else the default).
        const data = await resolveDeliveryCashLimitForPartner(req.user?.userId);
        return sendResponse(res, 200, 'Cash limit fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getDeliveryReferralStatsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const stats = await getDeliveryReferralStats(deliveryPartnerId);
        return sendResponse(res, 200, 'Referral stats fetched successfully', { stats });
    } catch (error) {
        next(error);
    }
};

