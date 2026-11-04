import crypto from "crypto";
import ms from "ms";
import { FoodUser } from "../users/user.model.js";
import { FoodAdmin } from "../admin/admin.model.js";
import { AdminResetOtp } from "../admin/adminResetOtp.model.js";
import { FoodRestaurant } from "../../modules/food/restaurant/models/restaurant.model.js";
import { FoodDeliveryPartner } from "../../modules/food/delivery/models/deliveryPartner.model.js";
import { findDeliveryPartnerByPhone } from "../../modules/food/delivery/services/delivery.service.js";
import { FoodReferralSettings } from "../../modules/food/admin/models/referralSettings.model.js";
import { FoodReferralLog } from "../../modules/food/admin/models/referralLog.model.js";
import { createOrUpdateOtp, verifyOtp, shouldUseStaticOtp } from "../otp/otp.service.js";
import { signAccessToken, signRefreshToken } from "./token.util.js";
import { FoodRefreshToken } from "../refreshTokens/refreshToken.model.js";
import { ValidationError, AuthError } from "./errors.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { sendAdminResetOtpEmail } from "../../utils/email.js";
import mongoose from "mongoose";
import { creditReferralReward } from "../../modules/food/user/services/userWallet.service.js";
import { FoodUserWallet } from "../../modules/food/user/models/userWallet.model.js";
import { FoodOrder } from "../../modules/food/orders/models/order.model.js";
import { FoodTransaction } from "../../modules/food/orders/models/foodTransaction.model.js";
import { FoodSupportTicket } from "../../modules/food/user/models/supportTicket.model.js";
import { FoodRestaurantMenu } from "../../modules/food/restaurant/models/restaurantMenu.model.js";
import { FoodRestaurantWithdrawal } from "../../modules/food/restaurant/models/foodRestaurantWithdrawal.model.js";
import { getRestaurantFinance } from "../../modules/food/restaurant/services/restaurantFinance.service.js";
import { FoodAddon } from "../../modules/food/restaurant/models/foodAddon.model.js";
import { FoodRestaurantOutletTimings } from "../../modules/food/restaurant/models/outletTimings.model.js";
import { FoodRestaurantSupportTicket } from "../../modules/food/restaurant/models/supportTicket.model.js";
import { FoodDeliveryWallet } from "../../modules/food/delivery/models/deliveryWallet.model.js";
import { FoodDeliveryCashDeposit } from "../../modules/food/delivery/models/foodDeliveryCashDeposit.model.js";
import { FoodDeliveryWithdrawal } from "../../modules/food/delivery/models/foodDeliveryWithdrawal.model.js";
import { DeliverySupportTicket as FoodDeliverySupportTicket } from "../../modules/food/delivery/models/supportTicket.model.js";

const ROLES = {
  USER: "USER",
  RESTAURANT: "RESTAURANT",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  ADMIN: "ADMIN",
};

// Excludes visually ambiguous characters (0/O, 1/I/L) so a code can be read
// aloud or typed from memory without mix-ups.
const SHORT_REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHORT_REFERRAL_CODE_LENGTH = 6;

async function generateUniqueShortReferralCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = "";
    for (let i = 0; i < SHORT_REFERRAL_CODE_LENGTH; i += 1) {
      code += SHORT_REFERRAL_CODE_ALPHABET[crypto.randomInt(SHORT_REFERRAL_CODE_ALPHABET.length)];
    }
    const existing = await FoodUser.findOne({ shortReferralCode: code }).select("_id").lean();
    if (!existing) return code;
  }
  // Astronomically unlikely after 10 tries at 32^6 combinations - fall back to
  // something guaranteed unique rather than looping forever.
  return `U${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Saves the FCM (and, for restaurant/rider, VoIP) token sent with an OTP
 * login. Both halves used to be silent either way — no log when the client
 * sent no fcmToken at all, and no log when the save itself failed — which is
 * exactly what makes "no FCM token in the DB after login" unexplainable from
 * the server logs alone. Every outcome is now logged.
 *
 * `fcmToken` missing is a normal, expected case (the client's collector can
 * legitimately resolve nothing — permission not yet granted, native bridge
 * not ready — and still proceeds with login rather than blocking it), so it
 * logs at info, not warn.
 */
async function savePushTokensOnLogin({ ownerType, ownerId, phone, fcmToken, platform, voipToken, deviceId }) {
  const normalizedPlatform = platform === "mobile" ? "mobile" : "web";
  if (!fcmToken) {
    logger.info(
      `[Login-FCM] ${ownerType}:${ownerId} (phone ...${String(phone || "").slice(-4)}): ` +
      `no fcmToken sent with login — nothing to save. The app's token collector returned nothing before OTP submit.`
    );
    return;
  }

  try {
    const { upsertFirebaseDeviceToken } = await import("../notifications/firebase.service.js");
    await upsertFirebaseDeviceToken({
      ownerType,
      ownerId: String(ownerId),
      token: fcmToken,
      platform: normalizedPlatform,
    });
    logger.info(
      `[Login-FCM] ${ownerType}:${ownerId} platform=${normalizedPlatform}: fcmToken saved ` +
      `(...${String(fcmToken).slice(-8)})`
    );
  } catch (error) {
    // Login must not fail because the push token save did — but a save that
    // silently fails here is indistinguishable from "never sent" without this.
    logger.warn(`[Login-FCM] ${ownerType}:${ownerId}: fcmToken save FAILED: ${error?.message || error}`);
  }

  // VoIP: restaurant/rider only, mobile only, and only when the login actually
  // carried a voipToken (older app builds, or web, send none — expected, not logged as an error).
  const normalizedVoipToken = String(voipToken || "").trim();
  if (normalizedPlatform !== "mobile" || !["RESTAURANT", "DELIVERY_PARTNER"].includes(ownerType)) return;
  if (!normalizedVoipToken) {
    logger.info(`[Login-FCM] ${ownerType}:${ownerId}: no voipToken sent with login (ok if the app build has no VoIP yet, or /mobile/save will register it shortly after)`);
    return;
  }
  if (!/^[0-9a-f]{64,200}$/i.test(normalizedVoipToken)) {
    logger.warn(
      `[Login-FCM] ${ownerType}:${ownerId}: voipToken REJECTED at login: not a valid PushKit token ` +
      `(got ${normalizedVoipToken.length} char(s), expected 64-200 hex characters)`
    );
    return;
  }
  try {
    const { upsertVoipDevice } = await import("../notifications/firebase.service.js");
    const result = await upsertVoipDevice({
      ownerType,
      ownerId: String(ownerId),
      voipToken: normalizedVoipToken,
      fcmToken,
      deviceId: String(deviceId || "").trim(),
    });
    logger.info(`[Login-FCM] ${ownerType}:${ownerId}: voipToken saved at login, voipConfigured=${result.voipConfigured}`);
  } catch (error) {
    logger.warn(`[Login-FCM] ${ownerType}:${ownerId}: voipToken save FAILED at login: ${error?.message || error}`);
  }
}

const toSafeImageUrl = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.url || value.secure_url || "";
  return "";
};

const sanitizeUserForAuthResponse = (userDoc = {}) => {
  const id = userDoc?._id?.toString?.() || userDoc?.id?.toString?.() || userDoc?._id || userDoc?.id || null;
  return {
    id,
    _id: id,
    name: userDoc?.name || "",
    phone: userDoc?.phone || "",
    email: userDoc?.email || "",
    role: userDoc?.role || ROLES.USER,
    isVerified: Boolean(userDoc?.isVerified),
    isActive: userDoc?.isActive !== false,
    profileImage: toSafeImageUrl(userDoc?.profileImage),
    gender: userDoc?.gender || null,
    referralCode: userDoc?.referralCode || "",
    refCode: userDoc?.referralCode || "",
    referralCount: Number(userDoc?.referralCount || 0),
    walletAmount: Number(userDoc?.walletAmount || 0),
  };
};

const sanitizeRestaurantForAuthResponse = (restaurantDoc = {}) => {
  const id =
    restaurantDoc?._id?.toString?.() ||
    restaurantDoc?.id?.toString?.() ||
    restaurantDoc?._id ||
    restaurantDoc?.id ||
    null;

  return {
    id,
    _id: id,
    name: restaurantDoc?.restaurantName || restaurantDoc?.name || "",
    restaurantName: restaurantDoc?.restaurantName || "",
    phone: restaurantDoc?.ownerPhone || restaurantDoc?.primaryContactNumber || "",
    email: restaurantDoc?.ownerEmail || "",
    status: restaurantDoc?.status || "",
    profileImage: toSafeImageUrl(restaurantDoc?.profileImage),
  };
};

const sanitizeDeliveryForAuthResponse = (deliveryDoc = {}) => {
  const id =
    deliveryDoc?._id?.toString?.() ||
    deliveryDoc?.id?.toString?.() ||
    deliveryDoc?._id ||
    deliveryDoc?.id ||
    null;

  return {
    id,
    _id: id,
    name: deliveryDoc?.name || "",
    phone: deliveryDoc?.phone || "",
    email: deliveryDoc?.email || "",
    status: deliveryDoc?.status || "",
    profileImage: toSafeImageUrl(deliveryDoc?.profilePhoto),
    walletAmount: Number(deliveryDoc?.walletAmount || 0),
    refCode: deliveryDoc?.referralCode || "",
  };
};

export const requestUserOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }

  const otp = await createOrUpdateOtp(phone);
  // TODO: integrate SMS provider here
  // ONLY expose OTP in response when USE_DEFAULT_OTP=true explicitly.
  // In development with real SMS, OTP must come via SMS, NOT in API response.
  // const shouldExposeOtp = config.useDefaultOtp === true;
  const shouldExposeOtp = shouldUseStaticOtp(phone);
  return shouldExposeOtp ? { otp } : {};
};
export const verifyUserOtpAndLogin = async (
  phone,
  otp,
  ref = null,
  fcmToken = null,
  platform = "web",
  name = null,
  confirmAction = null,
) => {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const existingUser = await FoodUser.findOne({ phone });
  
  // Only a self-deleted account (deletedAt set) offers restore / start fresh. An
  // account an admin blocked is also isActive=false but has no deletedAt, and the
  // restore flow used to flip it back to active - a blocked user could unblock
  // themselves just by signing in again.
  if (existingUser && existingUser.isActive === false && !existingUser.deletedAt) {
    throw new AuthError("Your account has been deactivated. Please contact support.");
  }

  // Decide if we should preserve the OTP record for a subsequent Restore/New action
  const isDeletedAccount = existingUser && existingUser.isActive === false;
  
  // For first-time signup or fresh start after deletion, require name before logging in
  const isFreshRegistration = !existingUser || confirmAction === "new";
  
  // Preserve OTP if:
  // 1. It is a deleted account and the user hasn't chosen restore/new yet.
  // 2. It is a fresh registration and they haven't provided a name yet (needs name prompt).
  const preserveOtp = (isDeletedAccount && !confirmAction) || (isFreshRegistration && !trimmedName);

  const result = await verifyOtp(phone, otp, preserveOtp);
  console.log(`[DEBUG] OTP Verification for ${phone}: valid=${result.valid}, reason=${result.reason}, preserve=${preserveOtp}, confirmAction=${confirmAction}`);

  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  if (isFreshRegistration && !trimmedName) {
    // Return a success response with a flag instead of throwing an error 
    // to avoid noisy 400 errors in the console.
    return { needsName: true };
  }

  let userDoc = existingUser;
  
  // Ensure user exists and mark as verified on successful OTP.
  // Check if user is new or hasn't provided a name yet
  const needsNamePrompt = !userDoc || !userDoc.name || String(userDoc.name).trim() === "" || String(userDoc.name).toLowerCase() === "null";
  const isNewUser = needsNamePrompt;

  // Handle soft-deleted accounts if found
  if (userDoc && userDoc.isActive === false) {
    if (!confirmAction) {
      // Return a flag to frontend to prompt for choice
      return {
        deletedAccountFound: true,
        phone,
        role: ROLES.USER,
        name: userDoc.name
      };
    }

    if (confirmAction === "restore") {
      // Restore the account
      userDoc.isActive = true;
      userDoc.deletedAt = null;
      await userDoc.save();
      logger.info({ userId: userDoc._id }, "User account restored successfully");
    } else if (confirmAction === "new") {
      // Rename old account to free up phone number
      const oldPhone = userDoc.phone;
      userDoc.phone = `${oldPhone}_deleted_${Date.now()}`;
      await userDoc.save();
      logger.info({ userId: userDoc._id }, "Old user account renamed for fresh start");
      
      // Create a brand new account
      userDoc = await FoodUser.create({
        phone: oldPhone,
        isVerified: true,
        name: trimmedName,
      });
    }
  }

  if (!userDoc) {
    userDoc = await FoodUser.create({
      phone,
      isVerified: true,
      name: trimmedName,
    });
  } else {
    let needsSave = false;
    if (!userDoc.isVerified) {
      userDoc.isVerified = true;
      needsSave = true;
    }
    if (trimmedName && !userDoc.name) {
      userDoc.name = trimmedName;
      needsSave = true;
    }
    if (needsSave) await userDoc.save();
  }

  // Block login for deactivated users
  if (userDoc.isActive === false) {
    throw new AuthError(
      "Your account has been deactivated. Please contact support.",
    );
  }

  // Update FCM token if provided
  if (fcmToken) {
    const { upsertFirebaseDeviceToken } = await import("../notifications/firebase.service.js");
    await upsertFirebaseDeviceToken({
      ownerType: "USER",
      ownerId: String(userDoc._id),
      token: fcmToken,
      platform: platform === "mobile" ? "mobile" : "web",
    });
  }

  // Ensure referralCode exists (used for share links on older accounts).
  if (!userDoc.referralCode) {
    userDoc.referralCode = String(userDoc._id);
    await userDoc.save();
  }
  if (!userDoc.shortReferralCode) {
    userDoc.shortReferralCode = await generateUniqueShortReferralCode();
    await userDoc.save();
  }

  // Referral crediting: only for brand new accounts.
  const refRaw = typeof ref === "string" ? String(ref).trim() : "";
  let referrerId = null;
  if (mongoose.Types.ObjectId.isValid(refRaw)) {
    referrerId = new mongoose.Types.ObjectId(refRaw);
  } else if (refRaw) {
    // Not a Mongo _id - try resolving as a short, human-typeable referral code.
    const byShortCode = await FoodUser.findOne({ shortReferralCode: refRaw.toUpperCase() }).select("_id").lean();
    if (byShortCode) referrerId = byShortCode._id;
  }
  if (isNewUser && referrerId) {
    try {
      {
        if (String(referrerId) !== String(userDoc._id)) {
          const [referrer, settingsDoc] = await Promise.all([
            FoodUser.findById(referrerId).select("_id referralCount").lean(),
            FoodReferralSettings.findOne({ isActive: true })
              .sort({ createdAt: -1 })
              .lean(),
          ]);

          if (referrer && settingsDoc) {
            const commissionPercent = Math.max(
              0,
              Number(settingsDoc.referralCommissionPercent) || 0,
            );
            const flatReward = Math.max(
              0,
              Number(settingsDoc.referralRewardUser) || 0,
            );
            const limit = Math.max(
              0,
              Number(settingsDoc.referralLimitUser) || 0,
            );

            if (commissionPercent > 0) {
              // Commission mode: nothing is paid at signup. The reward is a % of
              // the referee's first DELIVERED order, paid out later by the
              // order-delivery hook (order.model.js post('save') -> referral
              // commission service), which also enforces referralLimitUser.
              userDoc.referredBy = referrerId;
              await userDoc.save();

              await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: 0,
                status: "pending",
              });
            } else if (
              flatReward > 0 &&
              limit > 0 &&
              Number(referrer.referralCount || 0) < limit
            ) {
              userDoc.referredBy = referrerId;
              await userDoc.save();

              const log = await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: flatReward,
                status: "credited",
              });

              await Promise.all([
                FoodUser.updateOne(
                  { _id: referrerId },
                  { $inc: { referralCount: 1 } },
                ),
                creditReferralReward(referrerId, flatReward, {
                  role: "USER",
                  refereeId: String(userDoc._id),
                  referralLogId: String(log._id),
                }),
              ]);
            } else {
              await FoodReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: flatReward,
                status: "rejected",
                reason:
                  flatReward <= 0
                    ? "reward_disabled"
                    : limit <= 0
                      ? "limit_disabled"
                      : "limit_reached",
              });
            }
          }
        }
      }
    } catch (e) {
      // Never fail login due to referral errors.
      logger?.warn?.({ err: e }, "Referral crediting failed (user)");
    }
  }

  const user = userDoc.toObject();
  const payload = { userId: user._id.toString(), role: user.role || "USER" };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: user._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: sanitizeUserForAuthResponse(user),
    isNewUser,
  };
};

export const adminLogin = async (email, password) => {
  if (!email || !password) {
    throw new ValidationError("Email and password are required");
  }

  const admin = await FoodAdmin.findOne({ email });
  if (!admin) {
    throw new AuthError("Invalid credentials");
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    throw new AuthError("Invalid credentials");
  }

  if (admin.isActive === false) {
    throw new AuthError("Your account has been disabled. Contact the administrator.");
  }

  const role = String(admin.role || "ADMIN").toUpperCase();
  if (role !== "ADMIN" && role !== "SUB_ADMIN") {
    throw new AuthError("Invalid credentials");
  }

  const payload = { userId: admin._id.toString(), role };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: admin._id,
    token: refreshToken,
    expiresAt,
  });

  const userObj = admin.toObject();
  delete userObj.password;
  userObj.role = role;
  userObj.permissions = userObj.permissions || {};
  return { accessToken, refreshToken, user: userObj };
};

export const requestRestaurantOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone);
  // ONLY expose OTP in response when USE_DEFAULT_OTP=true explicitly.
  // In development with real SMS, OTP must come via SMS, NOT in API response.
  // const shouldExposeOtp = config.useDefaultOtp === true;
  const shouldExposeOtp = shouldUseStaticOtp(phone);
  return shouldExposeOtp ? { otp } : {};
};

export const verifyRestaurantOtpAndLogin = async (phone, otp, fcmToken, platform, confirmAction, pushExtras = {}) => {
  // Restaurants may store ownerPhone with country code or formatting.
  const digits = String(phone || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const phoneCandidates = [phone, digits, last10].filter(Boolean);
  const phoneOrFields = (field) => [
    { [field]: { $in: phoneCandidates } },
    ...(last10 ? [{ [field]: { $regex: new RegExp(last10 + "$") } }] : []),
  ];

  // Search for all matching restaurants to handle cases with multiple records (e.g. deleted vs active)
  const matchingRestaurants = await FoodRestaurant.find({
    $or: [
      ...phoneOrFields("ownerPhone"),
      ...phoneOrFields("primaryContactNumber"),
    ],
  });

  // Prioritize accounts: approved > pending > rejected > deleted
  const statusPriority = { approved: 1, pending: 2, payment_pending: 3, rejected: 4, deleted: 5 };
  const sortedRestaurants = matchingRestaurants.sort((a, b) => {
    const pA = statusPriority[a.status] || 99;
    const pB = statusPriority[b.status] || 99;
    return pA - pB;
  });

  const existingRestaurant = sortedRestaurants[0] || null;

  const isDeleted = existingRestaurant && existingRestaurant.status === "deleted";
  const preserveOtp = isDeleted && !confirmAction;

  // The code itself is never logged: anyone reading the logs could sign in with it.
  console.log(`[DEBUG] Restaurant OTP Login Attempt: phone=${phone}, otpDigits=${String(otp ?? "").length}, confirmAction=${confirmAction}`);
  const result = await verifyOtp(phone, otp, preserveOtp);
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  let restaurant = existingRestaurant;

  // Handle soft-deleted accounts if found
  if (restaurant && restaurant.status === "deleted") {
    if (!confirmAction) {
      return {
        deletedAccountFound: true,
        phone,
        role: ROLES.RESTAURANT,
        name: restaurant.restaurantName
      };
    }

    if (confirmAction === "restore") {
      restaurant.status = "approved";
      await restaurant.save();
      logger.info({ restaurantId: restaurant._id }, "Restaurant account restored successfully");
    } else if (confirmAction === "new") {
      const suffix = `_deleted_${Date.now()}`;
      
      // Rename ALL potential phone fields if they match any of the candidates
      const fieldsToRename = ["ownerPhone", "primaryContactNumber"];
      for (const field of fieldsToRename) {
        const val = restaurant[field];
        if (val) {
          const valDigits = String(val).replace(/\D/g, "");
          const searchDigits = String(phone).replace(/\D/g, "");
          // If the field contains the phone number we're verifying, rename it
          if (valDigits.includes(searchDigits) || searchDigits.includes(valDigits)) {
            restaurant[field] = `${val}${suffix}`;
          }
        }
      }
      
      await restaurant.save();
      logger.info({ restaurantId: restaurant._id }, "Old restaurant account renamed for fresh start");
      
      // Setting restaurant to null will trigger the "needsRegistration" flow below
      restaurant = null;
    }
  }

  if (!restaurant) {
    // Phone has been successfully verified, but no restaurant exists yet.
    // Frontend will use this to redirect into registration/onboarding.
    const { signRegistrationToken } = await import("./onboardingToken.js");
    return {
      needsRegistration: true,
      phone,
      // Lets the onboarding form store uploads server-side before the restaurant exists.
      registrationToken: signRegistrationToken(phone),
    };
  }

  // Save the push tokens sent with login (logged either way — see savePushTokensOnLogin).
  await savePushTokensOnLogin({
    ownerType: "RESTAURANT",
    ownerId: restaurant._id,
    phone,
    fcmToken,
    platform,
    voipToken: pushExtras?.voipToken,
    deviceId: pushExtras?.deviceId,
  });

  if (restaurant.status && (restaurant.status === "banned" || restaurant.status === "deleted")) {
    const message = "Your restaurant has been disabled. Reason: Disabled by admin";
    console.warn(`⚠️ [Auth-Restaurant] Login blocked for ${phone}: status=${restaurant.status}, message=${message}`);
    throw new AuthError(message);
  }

  const restaurantStatus = restaurant.status || "pending";

  // Onboarding saved but the one-time fee was never completed: send the partner back
  // to the payment step with a fresh scoped token instead of the pending screen.
  if (restaurantStatus === "payment_pending") {
    const { releaseIfNoOnboardingFeeDue } = await import(
      "../../modules/food/restaurant/services/onboardingPayment.service.js"
    );

    // The admin may have switched the onboarding fee off, or removed the pricing
    // rule for this zone and type, after this restaurant was left mid-payment.
    // Sending it back to a checkout with nothing to charge would be a dead end, so
    // it moves into the approval queue instead ("pending": approval still required).
    if (await releaseIfNoOnboardingFeeDue(restaurant._id)) {
      return {
        pendingApproval: true,
        restaurantId: String(restaurant._id),
        message:
          "Your restaurant registration is pending admin approval. You will be able to access your account once your request is approved.",
      };
    }

    const { signOnboardingToken } = await import("./onboardingToken.js");
    return {
      onboardingPaymentPending: true,
      restaurantId: String(restaurant._id),
      onboardingToken: signOnboardingToken(restaurant._id),
      message: "Please complete your onboarding payment to submit your restaurant for approval.",
    };
  }

  if (restaurantStatus !== "approved") {
    const isRejected = restaurantStatus === "rejected";
    // Re-apply resubmits through /register; this token (the phone was just
    // OTP-verified) is what lets it update the rejected registration instead of
    // colliding with it as "already exists".
    const registrationToken = isRejected
      ? (await import("./onboardingToken.js")).signRegistrationToken(phone)
      : undefined;
    return {
      pendingApproval: true,
      isRejected,
      ...(registrationToken ? { registrationToken } : {}),
      rejectionReason: isRejected ? restaurant.rejectionReason : null,
      message:
        isRejected
          ? (restaurant.rejectionReason
              ? `Your restaurant registration has been rejected. Reason: ${restaurant.rejectionReason}`
              : "Your restaurant registration has been rejected. Please contact support.")
          : "Your restaurant registration is pending approval.",
    };
  }

  const payload = { userId: restaurant._id.toString(), role: ROLES.RESTAURANT };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: restaurant._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: sanitizeRestaurantForAuthResponse(restaurant?.toObject?.() || restaurant),
    needsRegistration: false,
  };
};

export const reapplyRestaurant = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  // Deletion logic removed to preserve onboarding/profile details for re-apply edit flow
  return { success: true };
};

export const requestDeliveryOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone);
  // ONLY expose OTP in response when USE_DEFAULT_OTP=true explicitly.
  // In development with real SMS, OTP must come via SMS, NOT in API response.
  // const shouldExposeOtp = config.useDefaultOtp === true;
  const shouldExposeOtp = shouldUseStaticOtp(phone);
  return shouldExposeOtp ? { otp } : {};
};

export const verifyDeliveryOtpAndLogin = async (phone, otp, fcmToken, platform, confirmAction, pushExtras = {}) => {
  const existingPartner = await findDeliveryPartnerByPhone(phone);

  const isDeleted = existingPartner && existingPartner.status === "deleted";
  const preserveOtp = isDeleted && !confirmAction;

  const result = await verifyOtp(phone, otp, preserveOtp);
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  let deliveryPartner = existingPartner;

  // Handle soft-deleted accounts if found
  if (deliveryPartner && deliveryPartner.status === "deleted") {
    if (!confirmAction) {
      return {
        deletedAccountFound: true,
        phone,
        role: ROLES.DELIVERY_PARTNER,
        name: deliveryPartner.name
      };
    }

    if (confirmAction === "restore") {
      deliveryPartner.status = "approved";
      await deliveryPartner.save();
      logger.info({ partnerId: deliveryPartner._id }, "Delivery partner account restored successfully");
    } else if (confirmAction === "new") {
      const suffix = `_deleted_${Date.now()}`;
      deliveryPartner.phone = `${deliveryPartner.phone}${suffix}`;
      await deliveryPartner.save();
      logger.info({ partnerId: deliveryPartner._id }, "Old delivery partner account renamed for fresh start");
      
      // Setting deliveryPartner to null will trigger the "needsRegistration" flow below
      deliveryPartner = null;
    }
  }

  if (!deliveryPartner) {
    const { signRegistrationToken, DELIVERY_REGISTRATION_TOKEN_SCOPE } = await import("./onboardingToken.js");
    return {
      needsRegistration: true,
      phone,
      // Lets signup store document photos server-side before the partner exists.
      registrationToken: signRegistrationToken(phone, DELIVERY_REGISTRATION_TOKEN_SCOPE),
    };
  }

  // Save the push tokens sent with login (logged either way — see savePushTokensOnLogin).
  // CRITICAL: do this BEFORE returning pendingApproval so we can notify them when approved.
  await savePushTokensOnLogin({
    ownerType: 'DELIVERY_PARTNER',
    ownerId: deliveryPartner._id,
    phone,
    fcmToken,
    platform,
    voipToken: pushExtras?.voipToken,
    deviceId: pushExtras?.deviceId,
  });

  const partnerStatus = deliveryPartner.status || "pending";
  if (partnerStatus !== "approved") {
    const isRejected = partnerStatus === "rejected";
    return {
      pendingApproval: true,
      isRejected,
      rejectionReason: isRejected ? deliveryPartner.rejectionReason : null,
      message:
        isRejected
          ? (deliveryPartner.rejectionReason 
              ? `Your account was rejected: ${deliveryPartner.rejectionReason}`
              : "Your delivery account was not approved. Please contact support.")
          : "Your account is pending admin verification. You will be notified once approved.",
    };
  }

  const payload = {
    userId: deliveryPartner._id.toString(),
    role: ROLES.DELIVERY_PARTNER,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await FoodRefreshToken.create({
    userId: deliveryPartner._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: sanitizeDeliveryForAuthResponse(
      deliveryPartner?.toObject?.() || deliveryPartner,
    ),
    needsRegistration: false,
  };
};

export const logout = async (refreshToken, fcmToken, platform) => {
  if (!refreshToken) {
    throw new ValidationError("Refresh token is required");
  }

  // 1. Remove specific FCM token from ALL collections if provided
  if (fcmToken) {
    console.log(`[FCM-Logout] Starting logout-driven token removal: platform=${platform}, tokenPreview=${fcmToken?.slice(0, 10)}...`);
    
    // We try to remove the token from all 4 possible models regardless of the user ID, 
    // ensuring no stale connections are left across any role or app the user was logged into.
    const field = platform === "mobile" ? "fcmTokenMobile" : "fcmTokens";
    const models = [FoodUser, FoodRestaurant, FoodDeliveryPartner, FoodAdmin];
    
    try {
      await Promise.all([
        ...models.map((model) =>
          model.updateMany(
            { [field]: fcmToken },
            { $pull: { [field]: fcmToken } },
          ),
        ),
        // The same iPhone's VoIP registration goes too, or it would keep ringing with order calls.
        ...[FoodRestaurant, FoodDeliveryPartner].map((model) =>
          model.updateMany(
            { "voipDevices.fcmToken": fcmToken },
            { $pull: { voipDevices: { fcmToken } } },
          ),
        ),
      ]);
      console.log("[FCM-Logout] Token removed from all collections successfully");
    } catch (err) {
      logger.warn({ err }, "Failed to remove FCM token from all collections during logout");
    }
  }

  // 2. Invalidate the refresh token (standard logout procedure)
  const deleted = await FoodRefreshToken.deleteOne({ token: refreshToken });
  return { invalidated: deleted.deletedCount > 0 };
};

export const logoutAllDevices = async (userId) => {
  if (!userId) {
    throw new AuthError("User ID is required");
  }

  try {
    const id = typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

    // 1. Remove all refresh tokens for this user
    const deleted = await FoodRefreshToken.deleteMany({ userId: id });
    console.log(`✅ [LogoutAllDevices] Deleted ${deleted.deletedCount} refresh tokens for user ${id}`);

    // 2. Remove all FCM tokens for this user from all collections
    const models = [FoodUser, FoodRestaurant, FoodDeliveryPartner, FoodAdmin];
    await Promise.all(
      models.map(model => 
        model.updateOne(
          { _id: id },
          { $set: { fcmTokens: [], fcmTokenMobile: [] } }
        )
      )
    );

    return { invalidated: deleted.deletedCount > 0, count: deleted.deletedCount };
  } catch (error) {
    logger.error(`[Logout-All] Failed for ID=${userId}: ${error.message}`);
    throw error;
  }
};

export const getProfile = async (userId, role) => {
  if (!userId || !role) {
    throw new AuthError("Invalid token payload");
  }
  let profile = null;
  const id = userId;

  switch (role) {
    case ROLES.USER:
      profile = await FoodUser.findById(id).lean();
      break;
    case ROLES.ADMIN:
    case "SUB_ADMIN":
      profile = await FoodAdmin.findById(id).select("-password").lean();
      break;
    case ROLES.RESTAURANT:
      {
        const doc = await FoodRestaurant.findById(id).lean();
        if (!doc) break;

        const location =
          doc.addressLine1 ||
          doc.addressLine2 ||
          doc.area ||
          doc.city ||
          doc.state ||
          doc.pincode ||
          doc.landmark
            ? {
                addressLine1: doc.addressLine1 || "",
                addressLine2: doc.addressLine2 || "",
                area: doc.area || "",
                city: doc.city || "",
                state: doc.state || "",
                pincode: doc.pincode || "",
                landmark: doc.landmark || "",
              }
            : null;

        const menuImages = Array.isArray(doc.menuImages)
          ? doc.menuImages
              .map((m) => (m && (typeof m === "string" ? m : m.url)) || null)
              .filter(Boolean)
              .map((url) => ({ url, publicId: null }))
          : [];

        profile = {
          id: doc._id,
          _id: doc._id,
          // Frontend expects "name" and "location" for restaurant screens.
          name: doc.restaurantName || "",
          restaurantName: doc.restaurantName || "",
          cuisines: Array.isArray(doc.cuisines) ? doc.cuisines : [],
          location,
          ownerName: doc.ownerName || "",
          ownerEmail: doc.ownerEmail || "",
          ownerPhone: doc.ownerPhone || "",
          primaryContactNumber: doc.primaryContactNumber || "",
          profileImage: doc.profileImage ? { url: doc.profileImage } : null,
          menuImages,
          coverImages: [],
          openingTime: doc.openingTime || null,
          closingTime: doc.closingTime || null,
          openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
          status: doc.status || null,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          // These fields may not exist yet in DB, keep stable defaults for UI.
          rating: typeof doc.rating === "number" ? doc.rating : 0,
          totalRatings:
            typeof doc.totalRatings === "number" ? doc.totalRatings : 0,
        };
      }
      break;
    case ROLES.DELIVERY_PARTNER: {
      const partner = await FoodDeliveryPartner.findById(id).lean();
      if (!partner) break;
      const deliveryId = partner._id
        ? `DP-${partner._id.toString().slice(-8).toUpperCase()}`
        : null;
      profile = {
        ...partner,
        email: partner.email || null,
        deliveryId,
        status: partner.status === "rejected" ? "blocked" : partner.status,
        profileImage: partner.profilePhoto
          ? { url: partner.profilePhoto }
          : null,
        documents: {
          aadhar:
            partner.aadharPhoto || partner.aadharNumber
              ? {
                  number: partner.aadharNumber || null,
                  document: partner.aadharPhoto || null,
                }
              : null,
          pan:
            partner.panPhoto || partner.panNumber
              ? {
                  number: partner.panNumber || null,
                  document: partner.panPhoto || null,
                }
              : null,
          drivingLicense: partner.drivingLicensePhoto || partner.drivingLicenseNumber
            ? {
                number: partner.drivingLicenseNumber || null,
                document: partner.drivingLicensePhoto || null,
              }
            : null,
          bankDetails:
            partner.bankAccountHolderName ||
            partner.bankAccountNumber ||
            partner.bankIfscCode ||
            partner.bankName ||
            partner.upiId ||
            partner.upiQrCode
              ? {
                  accountHolderName: partner.bankAccountHolderName || null,
                  accountNumber: partner.bankAccountNumber || null,
                  ifscCode: partner.bankIfscCode || null,
                  bankName: partner.bankName || null,
                  upiId: partner.upiId || null,
                  upiQrCode: partner.upiQrCode || null,
                }
              : null,
        },
        location:
          partner.address || partner.city || partner.state
            ? {
                addressLine1: partner.address,
                city: partner.city,
                state: partner.state,
              }
            : null,
        vehicle:
          partner.vehicleType || partner.vehicleName || partner.vehicleNumber
            ? {
                type: partner.vehicleType,
                brand: partner.vehicleName,
                model: partner.vehicleName,
                number: partner.vehicleNumber,
              }
            : null,
      };
      break;
    }
    default:
      throw new AuthError("Unknown role");
  }

  if (!profile) {
    throw new AuthError("Profile not found");
  }
  return { user: profile };
};

export const deleteAccount = async (id, role) => {
  if (!id || !role) {
    throw new AuthError("Missing required parameters for account deletion");
  }

  try {
    if (role === ROLES.USER) {
      const user = await FoodUser.findById(id).lean();
      if (user?.email) {
        try {
          const { sendAccountDeletionEmail } = await import('../../utils/email.js');
          await sendAccountDeletionEmail({
            to: user.email,
            name: user.name || 'User',
            accountType: 'User',
            details: [
              ...(user.phone ? [{ label: 'Registered Phone', value: user.phone }] : [])
            ]
          });
        } catch (emailErr) {
          logger.error(`[DELETE-EMAIL] User ${id} deletion email error: ${emailErr?.message || emailErr}`);
        }
      }
      // Soft delete user: deactivate and pull tokens. 
      // We DO NOT delete orders, transactions, or wallet history to preserve admin revenue data.
      await FoodUser.updateOne({ _id: id }, { isActive: false, deletedAt: new Date(), fcmTokens: [], fcmTokenMobile: [] });
      await FoodRefreshToken.deleteMany({ userId: id });
    } else if (role === ROLES.RESTAURANT) {
      const restaurant = await FoodRestaurant.findById(id).lean();
      const recipientEmail = restaurant?.ownerEmail || restaurant?.email;
      if (recipientEmail) {
        try {
          const { sendAccountDeletionEmail } = await import('../../utils/email.js');
          await sendAccountDeletionEmail({
            to: recipientEmail,
            name: restaurant?.restaurantName || restaurant?.ownerName || 'Restaurant',
            accountType: 'Restaurant',
            details: [
              ...(restaurant?.ownerPhone ? [{ label: 'Registered Phone', value: restaurant.ownerPhone }] : [])
            ]
          });
        } catch (emailErr) {
          logger.error(`[DELETE-EMAIL] Restaurant ${id} deletion email error: ${emailErr?.message || emailErr}`);
        }
      }
      // Soft delete restaurant: mark as deleted.
      // We keep orders and transactions for admin analytics.
      await FoodRestaurant.updateOne({ _id: id }, { status: "deleted", deletedAt: new Date(), fcmTokens: [], fcmTokenMobile: [], isAcceptingOrders: false });
      await FoodRefreshToken.deleteMany({ userId: id });
    } else if (role === ROLES.DELIVERY_PARTNER) {
      const partner = await FoodDeliveryPartner.findById(id).lean();
      if (partner?.email) {
        try {
          const { sendAccountDeletionEmail } = await import('../../utils/email.js');
          await sendAccountDeletionEmail({
            to: partner.email,
            name: partner.name || 'Delivery Partner',
            accountType: 'Delivery Partner',
            details: [
              ...(partner.phone ? [{ label: 'Registered Phone', value: partner.phone }] : [])
            ]
          });
        } catch (emailErr) {
          logger.error(`[DELETE-EMAIL] Delivery Partner ${id} deletion email error: ${emailErr?.message || emailErr}`);
        }
      }
      // Soft delete delivery partner: mark as deleted.
      await FoodDeliveryPartner.updateOne({ _id: id }, { status: "deleted", deletedAt: new Date(), fcmTokens: [], fcmTokenMobile: [], availabilityStatus: "offline" });
      await FoodRefreshToken.deleteMany({ userId: id });
    } else {
      throw new AuthError("Invalid role for account deletion");
    }

    return { success: true, message: "Account deleted successfully" };
  } catch (error) {
    logger.error({ err: error, id, role }, "Failed to delete account");
    throw error;
  }
};


/** Get the current balance for any role (User, Restaurant, Delivery) before account deletion. */
export const checkAccountBalance = async (userId, role) => {
  if (!userId || !role) {
    throw new AuthError("Invalid token payload for balance check");
  }

  let balance = 0;
  let type = "Wallet";

  switch (role) {
    case ROLES.USER: {
      const wallet = await FoodUserWallet.findOne({ userId }).select("balance").lean();
      balance = Number(wallet?.balance || 0);
      type = "Wallet Balance";
      break;
    }
    case ROLES.RESTAURANT: {
      // Live payout lives in food_transactions, not food_restaurant_wallets.
      const finance = await getRestaurantFinance(userId);
      balance = Number(finance?.currentCycle?.estimatedPayout || 0);
      type = "Restaurant Available Balance";
      break;
    }
    case ROLES.DELIVERY_PARTNER: {
      const wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId: userId }).select("balance").lean();
      balance = Number(wallet?.balance || 0);
      type = "Delivery Pocket Balance";
      break;
    }
    default:
      throw new AuthError("Unknown role for balance check");
  }

  return { balance, type };
};

const ADMIN_SERVICES_ALLOWED = ["food", "quickCommerce", "taxi"];

/** Update admin profile (name, email, phone, profileImage). Only for ADMIN role. */
export const updateAdminProfile = async (userId, body) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await FoodAdmin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  if (body.name !== undefined) admin.name = String(body.name || "").trim();
  if (body.email !== undefined) {
    const normalizedEmail = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!normalizedEmail) {
      throw new ValidationError("Email is required");
    }
    if (normalizedEmail !== admin.email) {
      const duplicateAdmin = await FoodAdmin.findOne({
        _id: { $ne: admin._id },
        email: normalizedEmail,
      })
        .select("_id")
        .lean();
      if (duplicateAdmin) {
        throw new ValidationError("Email is already in use");
      }
    }
    admin.email = normalizedEmail;
  }
  if (body.phone !== undefined) admin.phone = String(body.phone || "").trim();
  if (body.profileImage !== undefined)
    admin.profileImage = String(body.profileImage || "").trim();
  // Normalize servicesAccess so legacy values (e.g. 'zomato') don't fail schema validation on save
  if (Array.isArray(admin.servicesAccess)) {
    const valid = admin.servicesAccess.filter((s) =>
      ADMIN_SERVICES_ALLOWED.includes(s),
    );
    admin.servicesAccess = valid.length ? valid : ["food"];
  } else {
    admin.servicesAccess = ["food"];
  }
  await admin.save();
  const profile = admin.toObject();
  delete profile.password;
  return { user: profile };
};

/** Change admin password. Only for ADMIN role. */
export const changeAdminPassword = async (
  userId,
  currentPassword,
  newPassword,
) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await FoodAdmin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  const isMatch = await admin.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AuthError("Current password is incorrect");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new ValidationError("New password must be at least 6 characters");
  }
  admin.password = newPassword;
  await admin.save();
  // A changed password must end every existing session, including a stolen one.
  await FoodRefreshToken.deleteMany({ userId: admin._id });

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Changed 🔐",
      body: `The password for admin account ${admin.email} has been changed. If this was not you, please contact support immediately.`,
      data: {
        type: "security_alert",
        subType: "password_change",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password change:", e);
  }

  return { success: true };
};

/** Admin forgot password: request OTP. Only accepts email that is registered as admin. */
export const requestAdminForgotPasswordOtp = async (email) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail) {
    throw new ValidationError("Email is required");
  }

  const genericResponse = {
    success: true,
    message: "If this email is registered, you will receive an OTP shortly.",
  };

  // Same answer whether or not the email exists, so this endpoint cannot be used
  // to discover which addresses are admin accounts.
  const admin = await FoodAdmin.findOne({ email: normalizedEmail });
  if (!admin) {
    logger.warn(`Admin reset OTP requested for unknown email ${normalizedEmail}`);
    return genericResponse;
  }

  const otp = config.useDefaultOtp
    ? "123456"
    : String(crypto.randomInt(100000, 999999));
  const ttlMs = (config.otpExpiryMinutes || 10) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await AdminResetOtp.findOneAndUpdate(
    { email: normalizedEmail },
    { otp, expiresAt, attempts: 0 },
    { upsert: true, new: true },
  );

  if (config.useDefaultOtp) {
    logger.info(`Admin reset OTP for ${normalizedEmail}: ${otp}`);
  }

  const sent = await sendAdminResetOtpEmail(normalizedEmail, otp);
  if (!sent && !config.useDefaultOtp) {
    logger.warn(
      `Admin OTP not sent by email to ${normalizedEmail}; check SMTP config.`,
    );
  }

  return genericResponse;
};

const ADMIN_RESET_MAX_ATTEMPTS = 5;

/** Admin forgot password: verify OTP and set new password in one call. */
export const resetAdminPasswordWithOtp = async (email, otp, newPassword) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otpStr = String(otp || "").replace(/\D/g, "");
  if (!normalizedEmail || !otpStr) {
    throw new ValidationError("Email and OTP are required");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new ValidationError("New password must be at least 6 characters");
  }

  const record = await AdminResetOtp.findOne({ email: normalizedEmail });
  if (!record) {
    throw new AuthError("OTP not found or expired. Please request a new code.");
  }
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw new AuthError("OTP has expired. Please request a new code.");
  }
  if ((record.attempts || 0) >= ADMIN_RESET_MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new AuthError("Too many incorrect attempts. Please request a new code.");
  }
  const expectedOtp = Buffer.from(String(record.otp));
  const providedOtp = Buffer.from(otpStr);
  if (expectedOtp.length !== providedOtp.length || !crypto.timingSafeEqual(expectedOtp, providedOtp)) {
    // Without a cap the 6-digit code for the admin account could be brute-forced.
    const updated = await AdminResetOtp.findOneAndUpdate(
      { _id: record._id },
      { $inc: { attempts: 1 } },
      { new: true },
    ).lean();
    if ((updated?.attempts ?? ADMIN_RESET_MAX_ATTEMPTS) >= ADMIN_RESET_MAX_ATTEMPTS) {
      await AdminResetOtp.deleteOne({ _id: record._id });
      throw new AuthError("Too many incorrect attempts. Please request a new code.");
    }
    throw new AuthError("Invalid OTP.");
  }


  const admin = await FoodAdmin.findOne({ email: normalizedEmail });
  if (!admin) {
    await record.deleteOne();
    throw new AuthError("Account not found.");
  }

  admin.password = newPassword;
  await admin.save();
  await record.deleteOne();
  // Whoever held a session before the reset (possibly the reason for it) is signed out.
  await FoodRefreshToken.deleteMany({ userId: admin._id });

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Reset Successful 🔐",
      body: `The password for admin account ${admin.email} has been reset via OTP.`,
      data: {
        type: "security_alert",
        subType: "password_reset",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password reset:", e);
  }

  return { success: true, message: "Password reset successfully." };
};

export const refreshAccessToken = async (token) => {
  if (!token) {
    throw new ValidationError("Refresh token is required");
  }

  const stored = await FoodRefreshToken.findOne({ token }).lean();
  if (!stored) {
    throw new AuthError("Invalid refresh token");
  }

  const jwt = await import("jsonwebtoken");
  let payload;
  try {
    payload = jwt.default.verify(token, config.jwtRefreshSecret);
  } catch {
    throw new AuthError("Invalid refresh token");
  }

  // If deactivated user, do not issue fresh access tokens (forces logout on client)
  if (payload?.role === "USER") {
    const u = await FoodUser.findById(payload.userId).select("isActive").lean();
    if (!u || u.isActive === false) {
      throw new AuthError("User account is deactivated");
    }
  }

  const newAccessToken = signAccessToken({
    userId: payload.userId,
    role: payload.role,
  });

  return { accessToken: newAccessToken, refreshToken: token };
};
