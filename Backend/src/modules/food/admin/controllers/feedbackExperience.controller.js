import { FeedbackExperience } from '../models/feedbackExperience.model.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import mongoose from 'mongoose';

/**
 * Create a new feedback experience entry.
 * POST /api/v1/food/restaurant/feedback-experience
 * POST /api/v1/food/user/feedback-experience
 * POST /api/v1/food/delivery/feedback-experience
 */
export const createFeedbackExperience = async (req, res) => {
    try {
        const { rating, comment, module } = req.body;
        const userId = req.user?.userId;

        if (rating === undefined || rating === null || rating === '') {
            return sendError(res, 400, 'Rating is required');
        }

        if (!userId) {
            return sendError(res, 401, 'User ID not found in token');
        }

        // Determine user model and default module based on role
        let targetModule = module;
        let userModel = 'FoodUser';
        let restaurantId = undefined;

        if (req.user?.role === 'RESTAURANT') {
            userModel = 'FoodRestaurant';
            restaurantId = userId;
            targetModule = targetModule || 'restaurant';
        } else if (req.user?.role === 'DELIVERY_PARTNER') {
            userModel = 'FoodDeliveryPartner';
            targetModule = targetModule || 'delivery';
        } else {
            userModel = 'FoodUser';
            targetModule = targetModule || 'user';
        }

        if (!['user', 'restaurant', 'delivery'].includes(targetModule)) {
            return sendError(res, 400, 'Invalid module specified. Must be user, restaurant, or delivery');
        }

        // Normalize rating to 1-5 scale (if client sent 0-10 or 1-5)
        let numRating = Number(rating);
        if (isNaN(numRating) || numRating < 0) {
            return sendError(res, 400, 'Invalid rating value');
        }
        let normalizedRating = numRating;
        if (numRating > 5) {
            normalizedRating = Math.min(5, Math.ceil(numRating / 2));
        } else {
            normalizedRating = Math.max(1, Math.min(5, Math.round(numRating)));
        }

        const feedbackData = {
            userId,
            userModel,
            rating: normalizedRating,
            comment: comment ? String(comment).trim() : `User rated ${numRating}/10 overall experience`,
            module: targetModule
        };

        if (restaurantId) {
            feedbackData.restaurantId = restaurantId;
        }

        const feedback = await FeedbackExperience.create(feedbackData);

        return sendResponse(res, 201, 'Feedback submitted successfully', feedback);
    } catch (error) {
        console.error('Error creating feedback:', error);
        return sendError(res, 500, 'Failed to submit feedback: ' + error.message);
    }
};

/**
 * Get all feedback experiences (Admin only).
 * GET /api/v1/food/admin/feedback-experiences
 */
export const getFeedbackExperiences = async (req, res) => {
    try {
        const { module, page = 1, limit = 10, startDate, endDate, rating, experience, search } = req.query;
        const query = {};
        
        if (module) {
            query.module = module;
        }

        // Date filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // Rating filter (supports 1-5 scale directly, gracefully handles 0-10 if sent)
        if (rating !== undefined && rating !== '') {
            const parsedRating = Number(rating);
            if (!isNaN(parsedRating) && parsedRating > 0) {
                query.rating = parsedRating > 5 ? Math.min(5, Math.ceil(parsedRating / 2)) : parsedRating;
            }
        }

        // Experience filter (mapping experience labels to rating ranges)
        if (experience) {
            switch (experience) {
                case 'very_bad': query.rating = 1; break;
                case 'bad': query.rating = 1; break;
                case 'below_average': query.rating = 2; break;
                case 'average': query.rating = 3; break;
                case 'above_average': query.rating = 4; break;
                case 'good': query.rating = 4; break;
                case 'very_good': query.rating = 5; break;
            }
        }

        const searchRaw = String(search || '').trim().slice(0, 80);
        if (searchRaw) {
            const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegex = new RegExp(escaped, 'i');
            const [matchedUsers, matchedRestaurants, matchedDeliveryPartners] = await Promise.all([
                FoodUser.find({
                    $or: [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }],
                })
                    .select('_id')
                    .limit(100)
                    .lean(),
                FoodRestaurant.find({
                    $or: [
                        { restaurantName: searchRegex },
                        { ownerName: searchRegex },
                        { ownerPhone: searchRegex },
                        { ownerEmail: searchRegex },
                    ],
                })
                    .select('_id')
                    .limit(100)
                    .lean(),
                FoodDeliveryPartner.find({
                    $or: [{ name: searchRegex }, { phone: searchRegex }, { email: searchRegex }],
                })
                    .select('_id')
                    .limit(100)
                    .lean(),
            ]);
            const searchOr = [{ comment: searchRegex }];
            if (mongoose.Types.ObjectId.isValid(searchRaw)) {
                searchOr.push({ _id: new mongoose.Types.ObjectId(searchRaw) });
            }
            if (matchedUsers.length) {
                searchOr.push({ userId: { $in: matchedUsers.map((u) => u._id) } });
            }
            if (matchedRestaurants.length) {
                searchOr.push({ userId: { $in: matchedRestaurants.map((r) => r._id) } });
                searchOr.push({ restaurantId: { $in: matchedRestaurants.map((r) => r._id) } });
            }
            if (matchedDeliveryPartners.length) {
                searchOr.push({ userId: { $in: matchedDeliveryPartners.map((d) => d._id) } });
            }
            query.$or = searchOr;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const feedbacks = await FeedbackExperience.find(query)
            .populate('userId', 'name phone email restaurantName ownerPhone ownerEmail')
            .populate('restaurantId', 'restaurantName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await FeedbackExperience.countDocuments(query);

        // Calculate statistics for the current query
        const allFeedbacksForStats = await FeedbackExperience.find(query).select('rating');
        const totalCount = allFeedbacksForStats.length;
        
        let avgRating = 0;
        let minRating = 0;
        let maxRating = 0;

        if (totalCount > 0) {
            const sum = allFeedbacksForStats.reduce((acc, curr) => acc + (Number(curr.rating) || 0), 0);
            avgRating = sum / totalCount;
            minRating = Math.min(...allFeedbacksForStats.map(f => Number(f.rating) || 0));
            maxRating = Math.max(...allFeedbacksForStats.map(f => Number(f.rating) || 0));
        }

        const statistics = {
            totalFeedback: totalCount,
            averageRating: avgRating,
            minRating,
            maxRating
        };

        // Normalize the feedback data to have consistent user fields
        const normalizedFeedbacks = feedbacks.map(fb => {
            const user = fb.userId || {};
            return {
                ...fb.toObject(),
                userName: user.name || user.restaurantName || 'N/A',
                userPhone: user.phone || user.ownerPhone || 'N/A',
                userEmail: user.email || user.ownerEmail || 'N/A'
            };
        });

        return sendResponse(res, 200, 'Feedbacks fetched successfully', {
            feedbacks: normalizedFeedbacks,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            },
            statistics
        });
    } catch (error) {
        console.error('Error fetching feedbacks:', error);
        return sendError(res, 500, 'Failed to fetch feedbacks');
    }
};

/**
 * Delete a feedback experience (Admin only).
 * DELETE /api/v1/food/admin/feedback-experiences/:id
 */
export const deleteFeedbackExperience = async (req, res) => {
    try {
        const { id } = req.params;
        const feedback = await FeedbackExperience.findByIdAndDelete(id);
        
        if (!feedback) {
            return sendError(res, 404, 'Feedback not found');
        }

        return sendResponse(res, 200, 'Feedback deleted successfully');
    } catch (error) {
        console.error('Error deleting feedback:', error);
        return sendError(res, 500, 'Failed to delete feedback');
    }
};
