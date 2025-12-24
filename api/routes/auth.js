// routes/auth.routes.js
import express from "express";
import prisma from "../config/db.js";
import { RouterSessionManager } from "../services/routerSessionService.js";

const router = express.Router();

/**
 * Login with M-Pesa transaction code
 * POST /api/auth/login-mpesa
 * Body: { mpesaCode, macAddress, ipAddress?, deviceName? }
 */
router.post("/login-mpesa", async (req, res) => {
  try {
    const { mpesaCode, macAddress, ipAddress, deviceName } = req.body;

    // Validate input
    if (!mpesaCode || !macAddress) {
      return res.status(400).json({
        success: false,
        message: "M-Pesa code and MAC address are required",
      });
    }

    console.log(
      `🔐 M-Pesa login attempt: Code=${mpesaCode}, MAC=${macAddress}`
    );

    // Find payment by M-Pesa code
    const payment = await prisma.payment.findUnique({
      where: { mpesaCode: mpesaCode.toUpperCase() },
      include: {
        user: true,
        plan: true,
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!payment) {
      console.log("❌ Invalid M-Pesa code");
      return res.status(404).json({
        success: false,
        message: "Invalid M-Pesa transaction code. Please check and try again.",
      });
    }

    // Check if payment was successful
    if (payment.status !== "SUCCESS") {
      console.log(`❌ Payment not successful: Status=${payment.status}`);
      return res.status(400).json({
        success: false,
        message: "This payment was not successful. Please make a new payment.",
      });
    }

    // Get the subscription associated with this payment
    const subscription = payment.subscription?.[0]; // Get first subscription from array

    if (!subscription) {
      console.log("❌ No subscription found for this payment");
      return res.status(404).json({
        success: false,
        message: "No subscription found for this payment code.",
      });
    }

    // Check if subscription is still active and not expired
    const now = new Date();
    const subscriptionEndTime = new Date(subscription.endTime);

    if (subscription.status === "EXPIRED" || subscriptionEndTime < now) {
      console.log(`❌ Subscription expired: EndTime=${subscriptionEndTime}`);

      // Update subscription status if not already marked expired
      if (subscription.status !== "EXPIRED") {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "EXPIRED" },
        });
      }

      return res.status(400).json({
        success: false,
        message: `Your subscription expired on ${subscriptionEndTime.toLocaleDateString()}. Please purchase a new plan to continue.`,
        expired: true,
        expiredAt: subscriptionEndTime,
      });
    }

    if (subscription.status === "CANCELLED") {
      console.log("❌ Subscription cancelled");
      return res.status(400).json({
        success: false,
        message:
          "This subscription has been cancelled. Please purchase a new plan.",
      });
    }

    // Check if subscription is active
    if (subscription.status !== "ACTIVE") {
      console.log(`❌ Subscription not active: Status=${subscription.status}`);
      return res.status(400).json({
        success: false,
        message: "This subscription is not active. Please contact support.",
      });
    }

    // Update user's MAC address if different
    if (payment.user.macAddress !== macAddress) {
      console.log(
        `📝 Updating user MAC address: ${payment.user.macAddress} → ${macAddress}`
      );
      await prisma.user.update({
        where: { id: payment.user.id },
        data: {
          macAddress,
          ...(deviceName && { deviceName }),
        },
      });
    }

    // End any existing active sessions for this user (disconnect old device)
    console.log("🔄 Checking for existing active sessions...");
    const existingSessions = await prisma.routerSession.findMany({
      where: {
        userId: payment.user.id,
        status: "ACTIVE",
        endedAt: null,
      },
    });

    if (existingSessions.length > 0) {
      console.log(
        `🛑 Found ${existingSessions.length} active session(s), ending them...`
      );
      for (const session of existingSessions) {
        try {
          await RouterSessionManager.end({ userId: payment.user.id });
          console.log(`✅ Ended session ${session.id}`);
        } catch (endError) {
          console.error(
            `⚠️  Failed to end session ${session.id}:`,
            endError.message
          );
        }
      }
    }

    // Start new router session on the new device
    console.log("🚀 Starting new router session...");
    let session;
    try {
      session = await RouterSessionManager.startAutomatic({
        subscriptionId: subscription.id,
        macAddress,
        ipAddress,
      });
      console.log(`✅ Session started: ${session.id}`);
    } catch (sessionError) {
      console.error("❌ Failed to start router session:", sessionError.message);
      return res.status(500).json({
        success: false,
        message: `Failed to connect to router: ${sessionError.message}`,
      });
    }

    // Calculate remaining time
    const remainingMs = subscriptionEndTime - now;
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingHours = Math.floor(
      (remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const remainingMinutes = Math.floor(
      (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
    );

    let remainingTimeText = "";
    if (remainingDays > 0) {
      remainingTimeText = `${remainingDays} day${
        remainingDays > 1 ? "s" : ""
      } ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`;
    } else if (remainingHours > 0) {
      remainingTimeText = `${remainingHours} hour${
        remainingHours !== 1 ? "s" : ""
      } ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
    } else {
      remainingTimeText = `${remainingMinutes} minute${
        remainingMinutes !== 1 ? "s" : ""
      }`;
    }

    console.log(`✅ Login successful for user ${payment.user.id}`);

    // Return success with user and subscription info
    res.json({
      success: true,
      message: "Login successful! You are now connected to the internet.",
      user: {
        id: payment.user.id,
        phone: payment.user.phone,
        username: payment.user.username,
        macAddress: payment.user.macAddress,
      },
      subscription: {
        id: subscription.id,
        plan: subscription.plan.name,
        startTime: subscription.startTime,
        endTime: subscription.endTime,
        remainingTime: remainingTimeText,
      },
      session: {
        id: session.id,
        startedAt: session.startedAt,
      },
    });
  } catch (error) {
    console.error("❌ M-Pesa login error:", error);
    res.status(500).json({
      success: false,
      message:
        error.message || "An error occurred during login. Please try again.",
    });
  }
});

/**
 * Login with username and password
 * POST /api/auth/login
 * Body: { username, password, macAddress, ipAddress?, deviceName? }
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password, macAddress, ipAddress, deviceName } = req.body;

    // Validate input
    if (!username || !password || !macAddress) {
      return res.status(400).json({
        success: false,
        message: "Username, password, and MAC address are required",
      });
    }

    console.log(`🔐 Username login attempt: ${username}, MAC=${macAddress}`);

    // Find user by username
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // Check password (plain text comparison - you should use bcrypt in production)
    if (user.password !== password) {
      console.log("❌ Invalid password");
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // Check if user is blocked
    if (user.status === "BLOCKED") {
      console.log("❌ User is blocked");
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked. Please contact support.",
      });
    }

    // Find active subscription
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        endTime: { gt: new Date() },
      },
      include: {
        plan: true,
      },
      orderBy: {
        endTime: "desc", // Get the subscription with the latest end time
      },
    });

    if (!activeSubscription) {
      console.log("❌ No active subscription");
      return res.status(400).json({
        success: false,
        message:
          "You don't have an active subscription. Please purchase a plan to continue.",
        noSubscription: true,
      });
    }

    // Update user's MAC address if different
    if (user.macAddress !== macAddress) {
      console.log(
        `📝 Updating user MAC address: ${user.macAddress} → ${macAddress}`
      );
      await prisma.user.update({
        where: { id: user.id },
        data: {
          macAddress,
          ...(deviceName && { deviceName }),
        },
      });
    }

    // End any existing active sessions (disconnect old device)
    console.log("🔄 Checking for existing active sessions...");
    const existingSessions = await prisma.routerSession.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        endedAt: null,
      },
    });

    if (existingSessions.length > 0) {
      console.log(
        `🛑 Found ${existingSessions.length} active session(s), ending them...`
      );
      for (const session of existingSessions) {
        try {
          await RouterSessionManager.end({ userId: user.id });
          console.log(`✅ Ended session ${session.id}`);
        } catch (endError) {
          console.error(
            `⚠️  Failed to end session ${session.id}:`,
            endError.message
          );
        }
      }
    }

    // Start new router session
    console.log("🚀 Starting new router session...");
    let session;
    try {
      session = await RouterSessionManager.startAutomatic({
        subscriptionId: activeSubscription.id,
        macAddress,
        ipAddress,
      });
      console.log(`✅ Session started: ${session.id}`);
    } catch (sessionError) {
      console.error("❌ Failed to start router session:", sessionError.message);
      return res.status(500).json({
        success: false,
        message: `Failed to connect to router: ${sessionError.message}`,
      });
    }

    // Calculate remaining time
    const now = new Date();
    const subscriptionEndTime = new Date(activeSubscription.endTime);
    const remainingMs = subscriptionEndTime - now;
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingHours = Math.floor(
      (remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const remainingMinutes = Math.floor(
      (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
    );

    let remainingTimeText = "";
    if (remainingDays > 0) {
      remainingTimeText = `${remainingDays} day${
        remainingDays > 1 ? "s" : ""
      } ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`;
    } else if (remainingHours > 0) {
      remainingTimeText = `${remainingHours} hour${
        remainingHours !== 1 ? "s" : ""
      } ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
    } else {
      remainingTimeText = `${remainingMinutes} minute${
        remainingMinutes !== 1 ? "s" : ""
      }`;
    }

    console.log(`✅ Login successful for user ${user.id}`);

    res.json({
      success: true,
      message: "Login successful! You are now connected to the internet.",
      user: {
        id: user.id,
        phone: user.phone,
        username: user.username,
        macAddress: user.macAddress,
      },
      subscription: {
        id: activeSubscription.id,
        plan: activeSubscription.plan.name,
        startTime: activeSubscription.startTime,
        endTime: activeSubscription.endTime,
        remainingTime: remainingTimeText,
      },
      session: {
        id: session.id,
        startedAt: session.startedAt,
      },
    });
  } catch (error) {
    console.error("❌ Username login error:", error);
    res.status(500).json({
      success: false,
      message:
        error.message || "An error occurred during login. Please try again.",
    });
  }
});

export default router;
