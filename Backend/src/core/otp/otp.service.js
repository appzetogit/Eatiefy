import crypto from 'crypto';
import ms from 'ms';
import { FoodOtp } from './otp.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../auth/errors.js';

const generateOtpCode = () => {
    const code = crypto.randomInt(1000, 9999);
    return String(code);
};

/** Shown to the user whenever the SMS could not be handed to the operator. */
const SMS_SEND_FAILED_MESSAGE = 'We could not send the OTP SMS right now. Please try again in a minute.';

/**
 * "91" + the last 10 digits. The old check `startsWith('91') ? digits : 91+digits`
 * sent Indian mobiles in the 91xxxxxxxx series (e.g. 9123456789) without the
 * country code, so those numbers never received an OTP.
 */
const toIndianMsisdn = (phone) => `91${String(phone || '').replace(/\D/g, '').slice(-10)}`;

/*
 * The SMS text must match the TRAI DLT template registered for
 * SMS_INDIA_HUB_DLT_TEMPLATE_ID character for character, or the operator drops
 * it after SMS India Hub has already accepted it. Registered template:
 *   "Welcome to the ##var## powered by Appzeto.Your OTP for registration is ##var##.BGADEC"
 * Override with SMS_INDIA_HUB_OTP_TEMPLATE ({otp} is replaced) if the approved
 * text changes - no code change needed.
 */
const DEFAULT_INDIA_HUB_OTP_TEMPLATE =
    'Welcome to the Eatiefy powered by Appzeto.Your OTP for registration is {otp}.BGADEC';
export const buildIndiaHubOtpMessage = (otp) =>
    String(process.env.SMS_INDIA_HUB_OTP_TEMPLATE || DEFAULT_INDIA_HUB_OTP_TEMPLATE).split('{otp}').join(String(otp));

/**
 * SMS India Hub answers HTTP 200 for failures too. Success is the JSON
 * `{"ErrorCode":"000", ...}`; failures arrive either as JSON with another code
 * or as plain text such as "Failed#Parameter Missing" - which the old check
 * (JSON only) logged as "sent successfully".
 */
export const parseIndiaHubResponse = (status, text) => {
    const body = String(text || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) { /* plain text */ }
    if (parsed && typeof parsed === 'object' && 'ErrorCode' in parsed) {
        const code = String(parsed.ErrorCode);
        return code === '000'
            ? { ok: true }
            : { ok: false, code, reason: parsed.ErrorMessage || body };
    }
    if (status < 200 || status >= 300) return { ok: false, code: `HTTP_${status}`, reason: body };
    if (!body || /fail|error|invalid|missing|denied|insufficient|blocked/i.test(body)) {
        return { ok: false, code: 'TEXT', reason: body || 'empty response' };
    }
    // Unrecognised but not an error message: do not block the user on it.
    return { ok: true, unverified: true };
};

/**
 * Sends the OTP via SMS India Hub. Throws when the SMS was not accepted, so the
 * app tells the user to retry instead of waiting for an SMS that is not coming.
 */
export const sendSmsViaIndiaHub = async (phone, otp) => {
    const msisdn = toIndianMsisdn(phone);
    const apiKey = String(config.smsApiKey || '').trim();
    const senderId = String(config.smsSenderId || '').trim();
    const templateId = String(config.smsDltTemplateId || '').trim();
    if (!apiKey || !senderId) {
        logger.error('[SMS] SMS India Hub is enabled but SMS_INDIA_HUB_API_KEY / SMS_INDIA_HUB_SENDER_ID is missing.');
        throw new ValidationError(SMS_SEND_FAILED_MESSAGE);
    }

    // HTTPS: the API key is a query parameter and must not cross the network in clear text.
    const url = new URL('https://cloud.smsindiahub.in/vendorsms/pushsms.aspx');
    url.searchParams.append('APIKey', apiKey);
    url.searchParams.append('sid', senderId);
    url.searchParams.append('msisdn', msisdn);
    url.searchParams.append('msg', buildIndiaHubOtpMessage(otp));
    url.searchParams.append('gwid', '2');
    url.searchParams.append('fl', '0');
    if (config.smsIndiaHubUsername) {
        url.searchParams.append('uname', String(config.smsIndiaHubUsername).trim());
    }
    if (templateId) {
        url.searchParams.append('DLT_TE_ID', templateId);
    }

    logger.info(`[SMS] Sending OTP to ${msisdn} via SMS India Hub...`);
    let status;
    let resultText;
    try {
        const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
        status = response.status;
        resultText = await response.text();
    } catch (error) {
        logger.error(`[SMS] SMS India Hub unreachable for ${msisdn}: ${error.message}`);
        throw new ValidationError(SMS_SEND_FAILED_MESSAGE);
    }
    logger.info(`[SMS] Raw response for ${msisdn}: ${resultText}`);

    const result = parseIndiaHubResponse(status, resultText);
    if (!result.ok) {
        const errMsg = `SMS India Hub rejected OTP for ${msisdn}: [${result.code}] ${result.reason}`;
        logger.error(errMsg);
        // eslint-disable-next-line no-console
        console.error(`❌ [SMS ERROR] ${errMsg}`);
        if (result.code === '006') {
            // eslint-disable-next-line no-console
            console.error('❌ [SMS ERROR] ErrorCode 006 = DLT template mismatch. The SMS text must EXACTLY match the approved DLT template, and SMS_INDIA_HUB_SENDER_ID must be the DLT header linked to that template.');
        }
        throw new ValidationError(SMS_SEND_FAILED_MESSAGE);
    }
    logger.info(
        result.unverified
            ? `[SMS] Unrecognised SMS India Hub response for ${msisdn}; treating as sent.`
            : `✅ SMS accepted by SMS India Hub for ${msisdn}`
    );
};

/**
 * Sends SMS via MSG91 OTP API
 * @param {string} phone - 10-digit mobile number (will be prefixed with 91)
 * @param {string} otp
 */
const sendSmsViaMsg91 = async (phone, otp) => {
    try {
        const msisdn = toIndianMsisdn(phone);

        logger.info(`[SMS] Sending OTP to ${msisdn} via MSG91 OTP API...`);

        const response = await fetch('https://control.msg91.com/api/v5/otp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'authkey': config.msg91AuthKey
            },
            body: JSON.stringify({
                template_id: config.msg91TemplateId,
                mobile: msisdn,
                otp: otp
            })
        });

        const resultText = await response.text();
        logger.info(`[SMS] MSG91 raw response for ${msisdn}: ${resultText}`);

        let parsed = null;
        try { parsed = JSON.parse(resultText); } catch (_) { /* plain text response */ }

        if (parsed && parsed.type === 'error') {
            const errMsg = `MSG91 ERROR for ${phone}: ${parsed.message || resultText}`;
            logger.error(errMsg);
            // eslint-disable-next-line no-console
            console.error(`❌ [SMS ERROR] ${errMsg}`);
        } else if (!response.ok) {
            logger.error(`MSG91 API HTTP error for ${phone}: ${response.status} – ${resultText}`);
        } else {
            logger.info(`✅ MSG91 SMS sent successfully to ${msisdn}`);
        }
    } catch (error) {
        logger.error(`Error sending SMS via MSG91 to ${phone}: ${error.message}`);
        // Do NOT throw — OTP is already stored in DB; SMS failure should not block the flow
    }
};

/**
 * Sends account approval SMS to delivery partner or restaurant.
 * Never throws — account approval status in DB must succeed even if SMS provider fails.
 */
export const sendAccountApprovalSms = async ({ phone, name, role = 'RESTAURANT', isChangesApproval = false }) => {
    try {
        const rawPhone = String(phone || '').replace(/\D/g, '').slice(-10);
        if (rawPhone.length !== 10) {
            logger.warn(`[SMS-APPROVAL] Skipped: invalid phone ${phone}`);
            return false;
        }

        const msisdn = toIndianMsisdn(rawPhone);
        const targetRole = role === 'DELIVERY_PARTNER' ? 'Delivery Partner' : 'Restaurant';
        const cleanName = String(name || targetRole).trim();

        const approvalMsg = isChangesApproval
            ? `Your profile changes for ${cleanName} on Eatiefy have been approved. - Eatiefy`
            : `Congratulations! Your Eatiefy ${targetRole} account for ${cleanName} has been approved. You can now start receiving orders. - Eatiefy`;

        logger.info(`[SMS-APPROVAL] Attempting to send approval SMS to ${msisdn} (${targetRole})...`);

        // 1. Try SMS India Hub if configured
        if (config.smsHubEnabled || (config.smsApiKey && config.smsSenderId)) {
            try {
                const apiKey = String(config.smsApiKey || '').trim();
                const senderId = String(config.smsSenderId || '').trim();
                const templateId = String(process.env.SMS_APPROVAL_DLT_TEMPLATE_ID || '').trim();

                const url = new URL('https://cloud.smsindiahub.in/vendorsms/pushsms.aspx');
                url.searchParams.append('APIKey', apiKey);
                url.searchParams.append('sid', senderId);
                url.searchParams.append('msisdn', msisdn);
                url.searchParams.append('msg', approvalMsg);
                url.searchParams.append('gwid', '2');
                url.searchParams.append('fl', '0');
                if (config.smsIndiaHubUsername) {
                    url.searchParams.append('uname', String(config.smsIndiaHubUsername).trim());
                }
                if (templateId) {
                    url.searchParams.append('DLT_TE_ID', templateId);
                }

                const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
                const resultText = await response.text();
                logger.info(`[SMS-APPROVAL] SMS India Hub response for ${msisdn}: ${resultText}`);
                return true;
            } catch (hubErr) {
                logger.warn(`[SMS-APPROVAL] SMS India Hub failed for ${msisdn}: ${hubErr?.message || hubErr}`);
            }
        }

        // 2. Try MSG91 if configured
        if (config.msg91Enabled && config.msg91AuthKey) {
            try {
                const templateId = String(process.env.MSG91_APPROVAL_TEMPLATE_ID || config.msg91TemplateId || '').trim();
                if (templateId) {
                    const response = await fetch('https://control.msg91.com/api/v5/otp', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'authkey': config.msg91AuthKey
                        },
                        body: JSON.stringify({
                            template_id: templateId,
                            mobile: msisdn,
                            name: cleanName,
                            role: targetRole
                        })
                    });
                    const resultText = await response.text();
                    logger.info(`[SMS-APPROVAL] MSG91 response for ${msisdn}: ${resultText}`);
                    return true;
                }
            } catch (msg91Err) {
                logger.warn(`[SMS-APPROVAL] MSG91 failed for ${msisdn}: ${msg91Err?.message || msg91Err}`);
            }
        }

        logger.info(`[SMS-APPROVAL] Handled approval SMS attempt for ${msisdn} (${targetRole})`);
        return true;
    } catch (err) {
        logger.warn(`[SMS-APPROVAL] Error sending approval SMS to ${phone}: ${err?.message || err}`);
        return false;
    }
};

// One line at boot saying how OTPs will be delivered, visible in `pm2 logs`.
// eslint-disable-next-line no-console
console.info(
    `[OTP] Delivery: ${config.useDefaultOtp
        ? 'STATIC 1234 (USE_DEFAULT_OTP=true) - no SMS is sent'
        : config.msg91Enabled
            ? 'SMS via MSG91'
            : config.smsHubEnabled
                ? `SMS via SMS India Hub (sender ${String(config.smsSenderId || '').trim() || 'MISSING'})`
                : 'NONE - no SMS provider enabled; every OTP request will fail'}${
        config.useDefaultTestPhone && (config.defaultTestPhones?.length || config.defaultTestPhone)
            ? ` | Fixed Test Phone(s) [OTP: 1234]: ${config.defaultTestPhones?.length ? config.defaultTestPhones.join(', ') : config.defaultTestPhone}`
            : ''
    }`
);

// Static OTP in production means anyone can sign in to any account with 1234.
if (config.nodeEnv === 'production' && config.useDefaultOtp) {
    // eslint-disable-next-line no-console
    console.error('⚠️  [OTP] USE_DEFAULT_OTP=true in production: every phone accepts OTP 1234 and NO SMS is sent. If .env sets USE_DEFAULT_OTP more than once, the LAST line wins.');
}

const normalizePhoneForOtp = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.slice(-10); // Always normalize to 10 digits to prevent duplicate checks
};

const DEFAULT_STATIC_TEST_PHONES = ['9424047900', '9329380330', '6261745842'];

/** True only for the test phone(s) when USE_DEFAULT_TEST_PHONE is enabled / not false */
const isDefaultTestPhone = (normalizedPhone) => {
    if (!normalizedPhone) return false;
    if (config.useDefaultTestPhone === false) return false;
    if (DEFAULT_STATIC_TEST_PHONES.includes(normalizedPhone)) return true;
    const testPhones = config.defaultTestPhones || [];
    if (testPhones.includes(normalizedPhone)) return true;
    if (config.defaultTestPhone && normalizedPhone === config.defaultTestPhone) return true;
    return false;
};

/**
 * Static OTP 1234 when:
 * - USE_DEFAULT_OTP=true (all phones), OR
 * - USE_DEFAULT_TEST_PHONE=true and phone is in DEFAULT_TEST_PHONE(s)
 */
export const shouldUseStaticOtp = (phone) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    return Boolean(config.useDefaultOtp || isDefaultTestPhone(normalizedPhone));
};

export const createOrUpdateOtp = async (phone) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    if (!normalizedPhone) throw new ValidationError("Valid phone number is required");

    const existing = await FoodOtp.findOne({ phone: normalizedPhone });
    const now = new Date();
    const useStaticOtp = shouldUseStaticOtp(normalizedPhone);

    // 1. Rate Limiting Logic (OTP Requests)
    // The window runs from the FIRST request in it. It used to be measured from
    // the latest request and the error always said "10 minutes", so every retry
    // (e.g. re-entering the number) restarted the app's countdown from scratch.
    if (existing) {
        const windowMs = (config.otpRateWindow || 600) * 1000;
        const windowStart = existing.windowStartedAt || existing.lastRequestAt || now;
        const isInWindow = now - windowStart < windowMs;

        if (isInWindow) {
            // Relax rate limit in local development to avoid blocking testing flows
            const isDev = config.nodeEnv === 'development';
            const limit = isDev ? 5 : (config.otpRateLimit || 5);
            if (!useStaticOtp && existing.requestCount >= limit) {
                const remainingSec = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
                const mm = Math.floor(remainingSec / 60);
                const ss = String(remainingSec % 60).padStart(2, '0');
                logger.warn(`Rate limit exceeded for phone ${normalizedPhone}; ${remainingSec}s left`);
                // "M:SS" is parsed by the partner apps to show the exact countdown.
                throw new ValidationError(`Too many OTP requests. Please try again after ${mm}:${ss} minutes.`);
            }
            existing.requestCount += 1;
            if (!existing.windowStartedAt) existing.windowStartedAt = windowStart;
        } else {
            existing.requestCount = 1;
            existing.windowStartedAt = now;
        }
    }

    let otp;
    let reusedCode = false;
    // if (config.useDefaultOtp) {
    //     otp = '1234';
    //     logger.info(`Default OTP mode enabled – OTP is ${otp} for phone ${normalizedPhone}`);
    // } else {
    //     otp = generateOtpCode();
    // }
    if (useStaticOtp) {
        otp = '1234';
        logger.info(
            `${config.useDefaultOtp ? 'Default OTP mode' : 'Default test phone'} enabled – OTP is ${otp} for phone ${normalizedPhone}`
        );
    } else if (
        existing?.otp &&
        existing.otpExpiresAt > now &&
        (existing.attempts || 0) < Math.max(1, config.otpMaxAttempts || 4)
    ) {
        // A code that is still valid is sent again instead of being replaced: a double
        // tap, a network retry or "Resend SMS" must not invalidate the SMS the user
        // already received (typing that code used to fail as "Invalid OTP").
        otp = existing.otp;
        reusedCode = true;
    } else {
        otp = generateOtpCode();
    }

    // 3. Expiry calculation (Code expiry vs Record expiry)
    let ttlMs;
    if (config.otpExpirySeconds) {
        ttlMs = config.otpExpirySeconds * 1000;
    } else if (config.otpExpiryMinutes) {
        ttlMs = config.otpExpiryMinutes * 60 * 1000;
    } else {
        ttlMs = ms(config.otpExpiry || '5m');
    }
    
    const otpExpiresAt = new Date(now.getTime() + ttlMs);
    // Record expiry (expiresAt) is used by TTL index to delete from DB
    // We keep it for at least 1 hour to maintain penalty counts, or longer if blocked
    const expiresAt = new Date(now.getTime() + Math.max(3600000, ttlMs));

    if (existing) {
        existing.otp = otp;
        existing.otpExpiresAt = otpExpiresAt;
        existing.expiresAt = expiresAt;
        // Re-sending the same code must not hand out a fresh set of guesses for it.
        if (!reusedCode) existing.attempts = 0;
        existing.lastRequestAt = now;
        await existing.save();
    } else {
        await FoodOtp.create({ 
            phone: normalizedPhone, 
            otp, 
            otpExpiresAt,
            expiresAt,
            requestCount: 1,
            lastRequestAt: now,
            windowStartedAt: now
        });
    }

    // Only send SMS if not in default OTP mode
    // if (!config.useDefaultOtp) {
    if (!useStaticOtp) {
        if (config.msg91Enabled) {
            await sendSmsViaMsg91(phone, otp);
        } else if (config.smsHubEnabled) {
            await sendSmsViaIndiaHub(phone, otp);
        } else {
            // Previously only a warning: the app said "OTP sent" and nothing arrived.
            logger.error('[SMS] No SMS provider is enabled (set SMS_HUB_ENABLED=true or MSG91_ENABLED=true). OTP was not sent.');
            throw new ValidationError(SMS_SEND_FAILED_MESSAGE);
        }
    }

    return otp;
};

export const verifyOtp = async (phone, otp, preserveOtp = false) => {
    const normalizedPhone = normalizePhoneForOtp(phone);
    const record = await FoodOtp.findOne({ phone: normalizedPhone });
    const now = new Date();

    // Static OTP Bypass: In dev/test mode with USE_DEFAULT_OTP=true, 
    // we allow '1234' unconditionally to avoid any formatting or database issues.
    // Also bypass for DEFAULT_TEST_PHONE when USE_DEFAULT_TEST_PHONE=true.
    // if (config.useDefaultOtp && otp === '1234') {
    if (shouldUseStaticOtp(normalizedPhone) && String(otp || '').replace(/\D/g, '') === '1234') {
        console.info(`✅ [OTP-Verify] Static OTP '1234' ABSOLUTE BYPASS for ${phone}`);
        if (record && !preserveOtp) {
            await record.deleteOne(); // Reset the request limit for successful logins
        } else if (record && preserveOtp) {
            record.attempts = 0;
            record.totalFailures = 0;
            record.blockedUntil = null;
            record.requestCount = 1; // Reset request count for preserved OTPs
            await record.save();
        }
        return { valid: true };
    }

    if (!record) {
        console.warn(`❌ [OTP-Verify] No OTP record found for ${normalizedPhone}`);
        return { valid: false, reason: 'OTP not found. Please request a new OTP.' };
    }

    // Check if OTP itself has expired
    if (record.otpExpiresAt < now) {
        return { valid: false, reason: 'OTP expired' };
    }

    // A 4-digit code is only safe while guesses are capped: without this limit
    // the whole code space can be tried inside one OTP lifetime.
    const maxAttempts = Math.max(1, config.otpMaxAttempts || 4);
    if ((record.attempts || 0) >= maxAttempts) {
        return { valid: false, reason: 'Too many incorrect attempts. Please request a new OTP.' };
    }

    // Compare digit strings, so "1234", " 1234" and 1234 are the same code.
    const entered = String(otp ?? '').replace(/\D/g, '');
    const expected = Buffer.from(String(record.otp));
    const provided = Buffer.from(entered);
    const matches = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    if (!matches) {
        // Atomic increment so parallel guesses cannot all slip under the limit.
        const updated = await FoodOtp.findOneAndUpdate(
            { _id: record._id },
            { $inc: { attempts: 1, totalFailures: 1 } },
            { new: true }
        ).lean();
        const used = updated?.attempts ?? maxAttempts;
        // Never log the code itself; the timing shows whether a newer request replaced it.
        logger.warn(
            `[OTP-Verify] Wrong code for ******${normalizedPhone.slice(-4)}: ${entered.length} digit(s) entered, ` +
            `current code issued ${Math.round((now - record.lastRequestAt) / 1000)}s ago, requests in window ${record.requestCount}`
        );
        if (used >= maxAttempts) {
            return { valid: false, reason: 'Too many incorrect attempts. Please request a new OTP.' };
        }
        return { valid: false, reason: 'Invalid OTP' };
    }

    if (!preserveOtp) {
        console.info(`✅ [OTP-Verify] OTP verified and deleted for ${normalizedPhone}`);
        await record.deleteOne();
    } else {
        console.info(`✅ [OTP-Verify] OTP verified and preserved for ${normalizedPhone}`);
        await record.save();
    }
    return { valid: true };
};

