import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";
import logger from "../utils/logger.js"; // ✅ use Winston logger

/**
 * ✅ Initiate STK Push
 */
export const startPayment = async (req, res) => {
  try {
    const { phone, userId, planId, macAddress, deviceName, deviceId } =
      req.body;

    if (!planId || (!userId && !macAddress && !deviceId)) {
      return res.status(400).json({
        message: "Missing planId and (userId, macAddress, or deviceId)",
      });
    }

    // Fetch plan
    const plan = await prisma.plan.findUnique({
      where: { id: Number(planId) },
    });
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    // ✅ Resolve or create user
    let user;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    } else {
      const where = deviceId ? { deviceId } : { macAddress };
      user = await prisma.user.findUnique({ where });

      if (!user) {
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            macAddress: macAddress || null,
            deviceName: deviceName || null,
            deviceId: deviceId || null,
            isGuest: true,
          },
        });
        logger.info(`🆕 Guest user created (deviceId=${deviceId})`);
      }
    }

    if (!user) {
      return res.status(404).json({ message: "User could not be resolved" });
    }

    // ✅ Create pending payment
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        method: "MPESA",
        status: "PENDING",
      },
    });

    // ✅ Trigger STK push
    const stkResponse = await initiateStkPush({
      amount: plan.price,
      phone: phone || user.phone,
      accountRef: `WIFI-${payment.id}`,
    });

    // ✅ Save identifiers
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
      `📲 STK Push initiated: Payment ${payment.id} for User ${user.id} (${plan.name})`
    );

    res.status(200).json({
      success: true,
      message: "STK push initiated",
      payment,
      stkResponse,
    });
  } catch (error) {
    logger.error(`STK push error: ${error.message}`);
    res.status(500).json({ message: "STK push failed", error: error.message });
  }
};

/**
 * ✅ Automate Callback Handling
 */
export const handleCallback = async (req, res) => {
  try {
    const { Body } = req.body;
    if (!Body?.stkCallback) return res.sendStatus(400);

    const callback = Body.stkCallback;
    const { CheckoutRequestID, ResultCode } = callback;
    const result = ResultCode === 0 ? "SUCCESS" : "FAILED";

    const metadataItems = callback?.CallbackMetadata?.Item || [];
    const mpesaCode =
      metadataItems.find((i) => i.Name === "MpesaReceiptNumber")?.Value || null;
    const amount =
      metadataItems.find((i) => i.Name === "Amount")?.Value || null;
    const phone =
      metadataItems.find((i) => i.Name === "PhoneNumber")?.Value || null;

    // ✅ Find payment
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    if (!payment) {
      logger.warn(
        `⚠️ Payment not found for CheckoutRequestID=${CheckoutRequestID}`
      );
      return res.status(200).json({ message: "No matching payment found" });
    }

    // ✅ Skip if already processed
    if (payment.status === "SUCCESS") {
      logger.info(`🔁 Payment ${payment.id} already processed`);
      return res.sendStatus(200);
    }

    // ✅ Update payment
    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result,
        mpesaCode,
        callbackData: Body,
      },
    });

    if (result === "SUCCESS") {
      await createSubscriptionForPayment(updatedPayment);
      const plan = await prisma.plan.findUnique({
        where: { id: payment.planId },
      });

      logger.info(
        `✅ Subscription created for User ${payment.userId} | Plan: ${plan.name} | Amount: ${amount}`
      );
    } else {
      logger.warn(
        `❌ Payment failed for user ${payment.userId}, reason: ${callback.ResultDesc}`
      );
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error(`Callback error: ${error.message}`);
    res.sendStatus(500);
  }
};
export const listPayments = async (req, res, next) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;

    if (search) {
      where.OR = [
        { user: { phone: { contains: search } } },
        { plan: { name: { contains: search } } },
        { mpesaCode: { contains: search } },
        { createdAt: { contains: search } },
      ];
    }
    const payments = await prisma.payment.findMany({
      include: {
        user: { select: { phone: true } },
        plan: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(payments);
  } catch (error) {
    next(error);
  }
};
export const getPaymentDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id: Number(id) },
      include: {
        user: { select: { phone: true, macAddress: true, deviceName: true } },
        plan: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.status(200).json(payment);
  } catch (error) {
    next(error);
  }
};
