import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";
import logger from "../utils/logger.js"; // ✅ use Winston logger

/**
 * ✅ Initiate STK Push
 */
export const startPayment = async (req, res) => {
  try {
    // ADD deviceHostname to the destructuring
    const { phone, userId, planId, macAddress, deviceName, deviceHostname, suggestedUsername } =
      req.body;

    console.log("📥 Payment request received:", {
      phone,
      userId,
      planId,
      macAddress,
      deviceName,
      deviceHostname, // ADD this
      suggestedUsername, // ADD this
    });

    // ... rest of your existing code ...

    // ✅ Resolve or create user - UPDATED SECTION
    let user = null;

    // Try to find user by ID first
    if (userId) {
      console.log("🔍 Looking up user by ID:", userId);
      user = await prisma.user.findUnique({
        where: { id: Number(userId) },
      });

      if (user) {
        console.log(`✅ Found existing user: ${user.id}`);

        // Update user info
        if (deviceHostname && !user.username.includes(deviceHostname)) {
          // If we have device hostname, update username to match
          const cleanHostname = deviceHostname.toLowerCase().replace(/[^a-z0-9-_]/g, '');
          user.username = cleanHostname;
        }
        
        if (macAddress || deviceName) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              username: user.username, // Include username update
              ...(macAddress && { macAddress }),
              ...(deviceName && { deviceName }),
            },
          });
        }
        console.log(`✅ User ${user.id} updated`);
      }
    }

    // If no user found by ID, try to find or create guest user
    if (!user) {
      console.log("🔍 Looking for existing guest user by MAC/phone/username...");

      // Generate username from device hostname or suggested username
      let username = deviceHostname || suggestedUsername;
      if (!username) {
        username = `user_${Math.random().toString(36).substring(2, 10)}`;
      }
      
      // Clean the username
      const cleanUsername = username.toLowerCase().replace(/[^a-z0-9-_]/g, '').substring(0, 30);
      
      console.log(`🆔 Generated username from device: ${cleanUsername}`);

      // Try to find existing user by MAC, phone, OR username
      const whereConditions = [];
      if (macAddress) whereConditions.push({ macAddress });
      if (phone) whereConditions.push({ phone });
      if (cleanUsername) whereConditions.push({ username: cleanUsername });

      if (whereConditions.length > 0) {
        user = await prisma.user.findFirst({
          where: {
            OR: whereConditions,
          },
        });

        console.log(
          "🔍 Guest lookup result:",
          user ? `Found user ${user.id} (${user.username})` : "No existing user"
        );
      }

      // Create new guest user if still not found
      if (!user) {
        console.log("🆕 Creating new user with device-based username...");
        
        // Generate password for new user
        const password = Math.random().toString(36).substring(2, 10);
        
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            username: cleanUsername, // Use device hostname as username
            password: password, // Set initial password
            macAddress: macAddress || null,
            deviceName: deviceName || null,
            deviceId: deviceId || null,
            isGuest: true,
            status: "ACTIVE",
            role: "USER",
          },
        });
        console.log(
          `✅ User created: ID=${user.id}, Username=${cleanUsername}, Password=${password}`
        );
        
        // Optionally send credentials via SMS
        if (phone) {
          const message = `Your WiFi account created!\nUsername: ${cleanUsername}\nPassword: ${password}\n\nSave these credentials for future logins.`;
          console.log(`📱 Would send SMS to ${phone}:`, message);
          // Uncomment to actually send SMS:
          // await sendSMS(phone, message);
        }
      } else {
        // Update existing user with latest info
        console.log("📝 Updating existing user with new info...");
        
        const updateData = {
          ...(phone && { phone }),
          ...(macAddress && { macAddress }),
          ...(deviceName && { deviceName }),
          ...(deviceId && { deviceId }),
        };
        
        // Update username if device hostname is provided and different
        if (deviceHostname && user.username !== cleanUsername) {
          updateData.username = cleanUsername;
        }
        
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        console.log(`✅ User ${user.id} updated with username: ${user.username}`);
      }
    }

    // ... rest of your existing payment code ...
  }
}

// paymentController.js or mpesaController.js

/**
 * ✅ Automate Callback Handling
 */
export const handleCallback = async (req, res) => {
  try {
    const { Body } = req.body;
    console.log("📥 STK Callback received:", JSON.stringify(Body));
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
      return res.status(200).json;
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

    // Build where clause
    const where = {};

    if (search) {
      where.OR = [
        { user: { phone: { contains: search } } },
        { plan: { name: { contains: search } } },
        { mpesaCode: { contains: search } },
      ];
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { phone: true, deviceName: true } },
        plan: { select: { name: true, price: true } },
      },
      orderBy: { transactionDate: "desc" }, // Use transactionDate instead of createdAt
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    console.error("List payments error:", error);
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
