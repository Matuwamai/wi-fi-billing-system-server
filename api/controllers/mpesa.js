// controllers/paymentController.js
import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Clean a raw string into a safe RADIUS username
 * e.g. "John's-Laptop!" → "johns-laptop"
 */
const sanitizeUsername = (raw = "") =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .substring(0, 30);

/**
 * Find or create a User record based on the request context.
 * Priority: userId → MAC → phone → deviceHostname → create new
 */
const resolveUser = async ({
  userId,
  phone,
  macAddress,
  deviceName,
  deviceHostname,
  suggestedUsername,
}) => {
  // 1. Lookup by explicit userId
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
    });
    if (user) {
      logger.info(`👤 Found user by ID: ${user.id}`);
      // Update any new device info
      const updates = {};
      if (macAddress && user.macAddress !== macAddress)
        updates.macAddress = macAddress;
      if (deviceName && user.deviceName !== deviceName)
        updates.deviceName = deviceName;
      if (Object.keys(updates).length) {
        return prisma.user.update({ where: { id: user.id }, data: updates });
      }
      return user;
    }
  }

  // 2. Build username from device hostname or suggestion
  const rawUsername =
    deviceHostname ||
    suggestedUsername ||
    `user_${Math.random().toString(36).substring(2, 10)}`;
  const cleanUsername = sanitizeUsername(rawUsername);

  // 3. Try to find by MAC, phone, or username
  const orConditions = [];
  if (macAddress) orConditions.push({ macAddress });
  if (phone) orConditions.push({ phone });
  if (cleanUsername) orConditions.push({ username: cleanUsername });

  if (orConditions.length) {
    const existing = await prisma.user.findFirst({
      where: { OR: orConditions },
    });
    if (existing) {
      logger.info(
        `👤 Found existing user: ${existing.id} (${existing.username})`,
      );
      const updates = {};
      if (phone && existing.phone !== phone) updates.phone = phone;
      if (macAddress && existing.macAddress !== macAddress)
        updates.macAddress = macAddress;
      if (deviceName && existing.deviceName !== deviceName)
        updates.deviceName = deviceName;
      if (deviceHostname && existing.username !== cleanUsername)
        updates.username = cleanUsername;
      if (Object.keys(updates).length) {
        return prisma.user.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      return existing;
    }
  }

  // 4. Create new guest user
  const password = Math.random().toString(36).substring(2, 10);
  const newUser = await prisma.user.create({
    data: {
      phone: phone || null,
      username: cleanUsername,
      password,
      macAddress: macAddress || null,
      deviceName: deviceName || null,
      isGuest: true,
      status: "ACTIVE",
      role: "USER",
    },
  });

  logger.info(
    `✅ New user created: ID=${newUser.id}, username=${cleanUsername}`,
  );

  // Optionally send SMS with credentials
  if (phone) {
    const msg = `Your WiFi account:\nUsername: ${cleanUsername}\nPassword: ${password}\nSave these for future logins.`;
    logger.info(`📱 [SMS stub] To ${phone}: ${msg}`);
    // await sendSMS(phone, msg);
  }

  return newUser;
};

// ─────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────

/**
 * POST /api/payments/initiate
 * Initiates an M-Pesa STK push for a WiFi plan purchase
 */
export const startPayment = async (req, res) => {
  try {
    const {
      phone,
      userId,
      planId,
      macAddress,
      deviceName,
      deviceHostname,
      suggestedUsername,
    } = req.body;

    // ── Validate required fields ──
    if (!planId) {
      return res
        .status(400)
        .json({ success: false, message: "planId is required" });
    }
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required for M-Pesa payment",
      });
    }

    logger.info(`📥 Payment initiation: planId=${planId}, phone=${phone}`);

    // ── Fetch plan ──
    const plan = await prisma.plan.findUnique({
      where: { id: Number(planId) },
    });
    if (!plan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    // ── Resolve or create user ──
    const user = await resolveUser({
      userId,
      phone,
      macAddress,
      deviceName,
      deviceHostname,
      suggestedUsername,
    });

    // ── Create pending payment record ──
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        method: "MPESA",
        status: "PENDING",
      },
    });

    logger.info(
      `💰 Payment created: ID=${payment.id}, amount=${payment.amount}`,
    );

    // ── Trigger STK push ──
    const stkResponse = await initiateStkPush({
      amount: plan.price,
      phone: phone || user.phone,
      accountRef: `WIFI-${payment.id}`,
    });

    // ── Persist STK checkout identifiers ──
    if (stkResponse?.CheckoutRequestID) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          checkoutRequestId: stkResponse.CheckoutRequestID,
          merchantRequestId: stkResponse.MerchantRequestID || null,
        },
      });
    }

    logger.info(
      `📲 STK push sent: payment=${payment.id}, user=${user.id}, plan=${plan.name}`,
    );

    return res.status(200).json({
      success: true,
      message: "STK push initiated. Check your phone to complete payment.",
      paymentId: payment.id,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        macAddress: user.macAddress,
      },
      stkResponse,
    });
  } catch (error) {
    logger.error(`❌ startPayment error: ${error.message}`, {
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: error.message,
    });
  }
};

/**
 * POST /api/payments/callback
 * Handles M-Pesa STK push callback (called by Safaricom)
 */
export const handleCallback = async (req, res) => {
  try {
    const { Body } = req.body;
    logger.info("📥 M-Pesa callback received");

    if (!Body?.stkCallback) {
      logger.warn("⚠️ Invalid callback body");
      return res.sendStatus(400);
    }

    const { CheckoutRequestID, ResultCode, ResultDesc } = Body.stkCallback;
    const isSuccess = ResultCode === 0;
    const status = isSuccess ? "SUCCESS" : "FAILED";

    // Extract metadata from callback
    const items = Body.stkCallback?.CallbackMetadata?.Item || [];
    const mpesaCode =
      items.find((i) => i.Name === "MpesaReceiptNumber")?.Value || null;
    const amount = items.find((i) => i.Name === "Amount")?.Value || null;
    const phone = items.find((i) => i.Name === "PhoneNumber")?.Value || null;

    // Find matching payment
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    if (!payment) {
      logger.warn(
        `⚠️ No payment found for CheckoutRequestID=${CheckoutRequestID}`,
      );
      return res.status(200).json({ message: "No matching payment" });
    }

    // Skip if already processed (idempotency)
    if (payment.status === "SUCCESS") {
      logger.info(`🔁 Payment ${payment.id} already processed — skipping`);
      return res.sendStatus(200);
    }

    // Update payment record
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status, mpesaCode, callbackData: Body },
    });

    if (isSuccess) {
      await createSubscriptionForPayment(updated);
      const plan = await prisma.plan.findUnique({
        where: { id: payment.planId },
      });
      logger.info(
        `✅ Subscription activated: user=${payment.userId}, plan=${plan?.name}, amount=${amount}`,
      );
    } else {
      logger.warn(
        `❌ Payment failed: user=${payment.userId}, reason=${ResultDesc}`,
      );
    }

    return res.sendStatus(200);
  } catch (error) {
    logger.error(`❌ handleCallback error: ${error.message}`, {
      stack: error.stack,
    });
    return res.sendStatus(500);
  }
};

/**
 * GET /api/payments
 * Admin: list payments with optional search/pagination
 */
export const listPayments = async (req, res) => {
  try {
    const { search, status, limit = 50, offset = 0 } = req.query;

    const where = {};

    if (status) where.status = status;

    if (search) {
      where.OR = [
        { user: { phone: { contains: search } } },
        { user: { username: { contains: search } } },
        { plan: { name: { contains: search } } },
        { mpesaCode: { contains: search } },
      ];
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          user: {
            select: { id: true, phone: true, username: true, deviceName: true },
          },
          plan: { select: { id: true, name: true, price: true } },
        },
        orderBy: { transactionDate: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.payment.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: payments });
  } catch (error) {
    logger.error(`❌ listPayments error: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch payments" });
  }
};

/**
 * GET /api/payments/:id
 * Admin: get single payment details
 */
export const getPaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id: Number(id) },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            username: true,
            macAddress: true,
            deviceName: true,
          },
        },
        plan: true,
        subscription: true,
      },
    });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment not found" });
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    logger.error(`❌ getPaymentDetails error: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch payment" });
  }
};

/**
 * GET /api/payments/status/:checkoutRequestId
 * Poll payment status after STK push (used by frontend)
 */
export const checkPaymentStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId },
      include: {
        plan: { select: { name: true } },
        subscription: { select: { id: true, status: true, endTime: true } },
      },
    });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment not found" });
    }

    return res.status(200).json({
      success: true,
      status: payment.status,
      plan: payment.plan?.name,
      subscription: payment.subscription?.[0] || null,
      mpesaCode: payment.mpesaCode,
    });
  } catch (error) {
    logger.error(`❌ checkPaymentStatus error: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to check payment status" });
  }
};
