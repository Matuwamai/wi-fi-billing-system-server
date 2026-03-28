// controllers/paymentController.js

import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";
import logger from "../utils/logger.js";

const PAYSTACK_SECRET = process.env.PAY_STACK_SCRETE_KEY;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const sanitizeUsername = (raw = "") =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .substring(0, 30);

/**
 * Find or create user (same logic as your previous code)
 */
const resolveUser = async ({
  userId,
  phone,
  macAddress,
  deviceName,
  deviceHostname,
  suggestedUsername,
}) => {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
    });
    if (user) return user;
  }

  const rawUsername =
    deviceHostname ||
    suggestedUsername ||
    `user_${Math.random().toString(36).substring(2, 10)}`;

  const cleanUsername = sanitizeUsername(rawUsername);

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ phone }, { macAddress }, { username: cleanUsername }],
    },
  });

  if (existing) return existing;

  const password = Math.random().toString(36).substring(2, 10);

  return prisma.user.create({
    data: {
      phone,
      username: cleanUsername,
      password,
      macAddress,
      deviceName,
      isGuest: true,
      status: "ACTIVE",
      role: "USER",
    },
  });
};

// ─────────────────────────────────────────────
// START PAYMENT
// ─────────────────────────────────────────────

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
    console.log("Received payment initiation:", req.body);

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "planId is required",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }

    const plan = await prisma.plan.findUnique({
      where: { id: Number(planId) },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    const user = await resolveUser({
      userId,
      phone,
      macAddress,
      deviceName,
      deviceHostname,
      suggestedUsername,
    });

    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        method: "PAYSTACK",
        status: "PENDING",
      },
    });

    // Initialize Paystack transaction
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `user${user.id}@wifi.neliteitsolution.com`,
          amount: plan.price * 100, // Paystack uses kobo/cents
          reference: `WIFI-${payment.id}`,
          callback_url: `${process.env.PAY_STACK_CALLBACK_URL}/payment-success`,
          metadata: {
            paymentId: payment.id,
            userId: user.id,
            planId: plan.id,
          },
        }),
      },
    );

    const data = await response.json();
    console.log("Paystack response:", data);

    if (!data.status) {
      throw new Error(data.message || "Paystack initialization failed");
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        reference: data.data.reference,
      },
    });

    return res.json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    });
  } catch (error) {
    logger.error(error.message);

    return res.status(500).json({
      success: false,
      message: "Payment initialization has failed",
    });
  }
};

// ─────────────────────────────────────────────
// PAYSTACK WEBHOOK
// ─────────────────────────────────────────────

export const handlePaystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event !== "charge.success") {
      return res.sendStatus(200);
    }

    const reference = event.data.reference;

    const payment = await prisma.payment.findFirst({
      where: { reference },
    });

    if (!payment) {
      logger.warn("Payment not found");
      return res.sendStatus(200);
    }

    if (payment.status === "SUCCESS") {
      return res.sendStatus(200);
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        paystackRef: event.data.id,
        callbackData: event,
      },
    });

    await createSubscriptionForPayment(updated);

    logger.info(`Subscription activated for user ${payment.userId}`);

    return res.sendStatus(200);
  } catch (error) {
    logger.error(error.message);
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
