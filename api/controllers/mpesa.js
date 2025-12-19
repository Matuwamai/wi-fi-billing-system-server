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

    console.log("📥 Payment request received:", {
      phone,
      userId,
      planId,
      macAddress,
      deviceName,
    });

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Missing planId",
      });
    }

    // Fetch plan
    const plan = await prisma.plan.findUnique({
      where: { id: Number(planId) },
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    console.log("✅ Plan found:", plan.name);

    // ✅ Resolve or create user
    let user = null;

    // Try to find user by ID first
    if (userId) {
      console.log("🔍 Looking up user by ID:", userId);
      user = await prisma.user.findUnique({
        where: { id: Number(userId) },
      });

      if (user) {
        console.log(`✅ Found existing user: ${user.id}`);

        // Update MAC address and device name
        if (macAddress || deviceName) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              ...(macAddress && { macAddress }),
              ...(deviceName && { deviceName }),
            },
          });
          console.log(
            `✅ User ${user.id} updated - MAC: ${macAddress}, Device: ${deviceName}`
          );
        }
      } else {
        console.log(`⚠️  User ID ${userId} not found, will create guest user`);
      }
    }

    // If no user found by ID, try to find or create guest user
    if (!user) {
      console.log("🔍 Looking for existing guest user by MAC/phone...");

      // Try to find existing guest user by MAC or phone
      const whereConditions = [];
      if (macAddress) whereConditions.push({ macAddress });
      if (phone) whereConditions.push({ phone });

      if (whereConditions.length > 0) {
        user = await prisma.user.findFirst({
          where: {
            OR: whereConditions,
          },
        });

        console.log(
          "🔍 Guest lookup result:",
          user ? `Found user ${user.id}` : "No existing user"
        );
      }

      // Create new guest user if still not found
      if (!user) {
        console.log("🆕 Creating new guest user...");
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            macAddress: macAddress || null,
            deviceName: deviceName || null,
            deviceId: deviceId || null,
            isGuest: true,
          },
        });
        console.log(
          `✅ Guest user created: ID=${user.id}, Phone=${phone}, MAC=${macAddress}`
        );
      } else {
        // Update existing user with latest info
        console.log("📝 Updating existing user with new info...");
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            ...(phone && { phone }),
            ...(macAddress && { macAddress }),
            ...(deviceName && { deviceName }),
            ...(deviceId && { deviceId }),
          },
        });
        console.log(`✅ User ${user.id} updated`);
      }
    }

    console.log("✅✅ User successfully resolved:", {
      id: user.id,
      phone: user.phone,
      macAddress: user.macAddress,
      isGuest: user.isGuest,
    });

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

    console.log(
      `💰 Payment created: ID=${payment.id}, Amount: ${payment.amount}`
    );

    // ✅ Trigger STK push
    const stkResponse = await initiateStkPush({
      amount: plan.price,
      phone: phone || user.phone,
      accountRef: `WIFI-${payment.id}`,
    });

    // ✅ Save STK identifiers
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
      user: {
        id: user.id,
        phone: user.phone,
        macAddress: user.macAddress,
      },
      stkResponse,
    });
  } catch (error) {
    console.error("❌ Payment error:", error);
    console.error("Error stack:", error.stack);
    logger.error(`STK push error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "STK push failed",
      error: error.message,
    });
  }
};

// paymentController.js or mpesaController.js
export const initiatePayment = async (req, res) => {
  try {
    const { phone, userId, planId, macAddress, deviceName } = req.body;

    console.log("Payment request:", {
      phone,
      userId,
      planId,
      macAddress,
      deviceName,
    });

    // Validate inputs
    if (!phone || !userId || !planId) {
      return res.status(400).json({
        success: false,
        message: "Phone, userId, and planId are required",
      });
    }

    // Update user with MAC address and device name if provided
    if (macAddress || deviceName) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ...(macAddress && { macAddress }),
          ...(deviceName && { deviceName }),
        },
      });
      console.log(
        `✅ User ${userId} updated with MAC: ${macAddress}, Device: ${deviceName}`
      );
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        userId,
        planId,
        phone,
        amount: plan.price, // Get from plan
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
    console.error("Payment initiation error:", error);
    res.status(500).json({ success: false, message: error.message });
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
