import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodRestaurantWithdrawal } from '../models/foodRestaurantWithdrawal.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { getRestaurantFinance } from '../services/restaurantFinance.service.js';

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { amount, bankDetails } = req.body;

        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');
        if (!amount || amount <= 0) return sendError(res, 400, 'Invalid withdrawal amount');

        // Check if restaurant has enough balance
        const finance = await getRestaurantFinance(restaurantId);
        const availableBalance = finance?.currentCycle?.estimatedPayout || 0;

        if (amount > availableBalance) {
            return sendError(res, 400, `Insufficient balance. Available: ₹${availableBalance}`);
        }

        const restaurant = await FoodRestaurant.findById(restaurantId)
            .select('restaurantName ownerName phone ownerPhone accountNumber ifscCode bankName accountHolderName')
            .lean();

        const effectiveBankDetails = bankDetails || {
            accountNumber: restaurant?.accountNumber,
            ifscCode: restaurant?.ifscCode,
            bankName: restaurant?.bankName,
            accountHolderName: restaurant?.accountHolderName
        };

        // Create the withdrawal request
        const withdrawal = new FoodRestaurantWithdrawal({
            restaurantId,
            amount,
            bankDetails: effectiveBankDetails,
            status: 'pending'
        });

        await withdrawal.save();

        // Notify admins: push + live panel alert
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            const restaurantName = restaurant?.restaurantName || 'A restaurant';
            const formattedAmount = Number(amount).toLocaleString('en-IN');
            void notifyAdminsSafely({
                title: 'New Withdrawal Request',
                body: `${restaurantName} requested a withdrawal of ₹${formattedAmount}.`,
                link: '/admin/food/restaurant-withdraws',
                idempotencyKey: `restaurant_withdrawal:${String(withdrawal._id)}`,
                data: {
                    type: 'restaurant_withdrawal',
                    subType: 'restaurant',
                    id: String(withdrawal._id),
                    restaurantId: String(restaurantId),
                    amount: String(amount),
                    link: '/admin/food/restaurant-withdraws'
                }
            });
        } catch (notifErr) {
            // eslint-disable-next-line no-console
            console.error('Failed to notify admins of restaurant withdrawal request:', notifErr?.message || notifErr);
        }

        return sendResponse(res, 201, 'Withdrawal request submitted successfully', withdrawal);
    } catch (error) {
        next(error);
    }
};

export const listMyWithdrawalsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Restaurant authentication required');

        const withdrawals = await FoodRestaurantWithdrawal.find({ restaurantId })
            .sort({ createdAt: -1 })
            .lean();

        return sendResponse(res, 200, 'Withdrawals fetched successfully', withdrawals);
    } catch (error) {
        next(error);
    }
};
