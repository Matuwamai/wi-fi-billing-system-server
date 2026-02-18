// controllers/authController.js
import prisma from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getActiveSubscription } from "../services/subscriptionService.js";
import { RadiusManager } from "../services/RadiusManager.js";
import logger from "../utils/logger.js";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });

const safeUser = (user) => ({
  id: user.id,
  phone: user.phone,
  username: user.username,
  deviceName: user.deviceName,
  role: user.role,
  isGuest: user.isGuest,
  status: user.status,
});

/**
 * Calculate human-readable remaining time from now until endTime
 */
const remainingTimeText = (endTime) => {
  const ms = new Date(endTime) - new Date();
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// ─────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Register a standard (non-guest) user with phone + password
 */
export const registerUser = async (req, res) => {
  try {
    const { phone, password, username, macAddress, deviceName } = req.body;

    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    const exists = await prisma.user.findUnique({ where: { phone } });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "Phone number already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        phone,
        password: hashedPassword,
        username: username || null,
        macAddress: macAddress || null,
        deviceName: deviceName || null,
        isGuest: false,
        status: "ACTIVE",
        role: "USER",
      },
    });

    const token = signToken(user);
    logger.info(`✅ User registered: ${user.id} (${phone})`);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: safeUser(user),
    });
  } catch (error) {
    logger.error(`❌ registerUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Registration failed" });
  }
};



/** * PUT /api/auth/login/admin
 * Admin: login with phone + password (for admin panel access)
 */
export const loginAdmin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { phone } });

    if (!user || user.role !== "ADMIN") {
      return res
        .status(404)
        .json({ success: false, message: "Admin account not found" });
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = signToken(user);
    logger.info(`✅ Admin login: user=${user.id} (${phone})`);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser(user),
    });
  } catch (error) {
    logger.error(`❌ loginAdmin: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Login failed" });
  }
/**
 * 
 * POST /api/auth/login
 * Login with username + password (used from captive portal)
 * RADIUS handles the actual WiFi auth; this returns a JWT for the API
 */
export const loginUser = async (req, res) => {
  try {
    const { username, phone, password, macAddress, deviceName } = req.body;

    if ((!username && !phone) || !password) {
      return res.status(400).json({
        success: false,
        message: "Username/phone and password are required",
      });
    }

    // Find user by username or phone
    const user = await prisma.user.findFirst({
      where: username ? { username } : { phone },
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Verify password (supports both bcrypt hashed and plain-text for legacy)
    let passwordValid = false;
    if (user.password?.startsWith("$2")) {
      passwordValid = await bcrypt.compare(password, user.password);
    } else {
      passwordValid = user.password === password; // plain text (guest/auto-generated)
    }

    if (!passwordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    if (user.status === "BLOCKED") {
      return res
        .status(403)
        .json({ success: false, message: "Account blocked. Contact support." });
    }

    // Update MAC / device info if provided
    if (macAddress || deviceName) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(macAddress && { macAddress }),
          ...(deviceName && { deviceName }),
          lastLogin: new Date(),
        },
      });
    }

    // Fetch active subscription
    const subscription = await getActiveSubscription(user.id);

    const token = signToken(user);
    logger.info(`✅ Login: user=${user.id} (${user.username || user.phone})`);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser(user),
      subscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan.name,
            rateLimit: subscription.plan.rateLimit,
            startTime: subscription.startTime,
            endTime: subscription.endTime,
            remainingTime: remainingTimeText(subscription.endTime),
          }
        : null,
    });
  } catch (error) {
    logger.error(`❌ loginUser: ${error.message}`);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
};

/**
 * POST /api/auth/login-mpesa
 * Login using an M-Pesa receipt code (no password needed)
 * Used from the captive portal after a payment
 */
export const loginWithMpesa = async (req, res) => {
  try {
    const { mpesaCode, macAddress, deviceName, ipAddress } = req.body;

    if (!mpesaCode || !macAddress) {
      return res.status(400).json({
        success: false,
        message: "mpesaCode and macAddress are required",
      });
    }

    // Find the successful payment
    const payment = await prisma.payment.findUnique({
      where: { mpesaCode: mpesaCode.toUpperCase() },
      include: {
        user: true,
        plan: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid M-Pesa code" });
    }

    if (payment.status !== "SUCCESS") {
      return res
        .status(400)
        .json({ success: false, message: "Payment was not successful" });
    }

    const subscription = payment.subscription?.[0];
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "No subscription linked to this payment",
      });
    }

    // Check subscription validity
    const now = new Date();
    const endTime = new Date(subscription.endTime);

    if (subscription.status === "EXPIRED" || endTime < now) {
      // Auto-mark as expired if missed
      if (subscription.status !== "EXPIRED") {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "EXPIRED" },
        });
      }
      return res.status(400).json({
        success: false,
        message: `Subscription expired on ${endTime.toLocaleDateString()}`,
        expired: true,
        expiredAt: endTime,
      });
    }

    if (subscription.status !== "ACTIVE") {
      return res
        .status(400)
        .json({ success: false, message: "Subscription is not active" });
    }

    // Update MAC address on user record
    if (macAddress || deviceName) {
      await prisma.user.update({
        where: { id: payment.user.id },
        data: {
          ...(macAddress && { macAddress }),
          ...(deviceName && { deviceName }),
          lastLogin: new Date(),
        },
      });
    }

    // Verify RADIUS user still exists & is provisioned
    const radiusCheck = await prisma.radCheck.findFirst({
      where: { username: payment.user.username },
    });

    if (!radiusCheck) {
      logger.warn(
        `⚠️ RADIUS user missing for ${payment.user.username} — re-provisioning`,
      );
      await RadiusManager.createRadiusUser({
        username: payment.user.username,
        password: payment.user.password,
        planProfile: { rateLimit: subscription.plan.rateLimit || "10M/10M" },
      });
    }

    const token = signToken(payment.user);
    logger.info(`✅ M-Pesa login: user=${payment.user.id}, code=${mpesaCode}`);

    return res.status(200).json({
      success: true,
      message: "Login successful! You are now connected.",
      token,
      user: safeUser(payment.user),
      subscription: {
        id: subscription.id,
        plan: subscription.plan.name,
        rateLimit: subscription.plan.rateLimit,
        startTime: subscription.startTime,
        endTime: subscription.endTime,
        remainingTime: remainingTimeText(subscription.endTime),
      },
      // MikroTik will use these credentials for RADIUS auth
      radiusCredentials: {
        username: payment.user.username,
        password: payment.user.password,
      },
    });
  } catch (error) {
    logger.error(`❌ loginWithMpesa: ${error.message}`);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
};

/**
 * POST /api/auth/guest
 * Create or retrieve a guest user by device info
 * Used for voucher redemption or trial access
 */
export const createGuestUser = async (req, res) => {
  try {
    const { deviceName, phone } = req.body;

    if (!deviceName) {
      return res
        .status(400)
        .json({ success: false, message: "deviceName is required" });
    }

    // Try to find existing guest by phone or deviceName
    let user = null;
    if (phone) {
      user = await prisma.user.findUnique({ where: { phone } });
    }
    if (!user) {
      user = await prisma.user.findFirst({
        where: { deviceName, isGuest: true },
      });
    }

    if (!user) {
      const password = Math.random().toString(36).substring(2, 10);
      const username = `guest_${Date.now().toString(36)}`;
      user = await prisma.user.create({
        data: {
          phone: phone || null,
          username,
          password,
          deviceName,
          isGuest: true,
          status: "ACTIVE",
          role: "USER",
        },
      });
      logger.info(`✅ Guest user created: ${user.id} (${username})`);
    }

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: "Guest user ready",
      token,
      user: safeUser(user),
    });
  } catch (error) {
    logger.error(`❌ createGuestUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create guest user" });
  }
};

/**
 * GET /api/auth/me
 * Get the currently authenticated user (requires JWT)
 */
export const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const subscription = await getActiveSubscription(user.id);

    return res.status(200).json({
      success: true,
      user: safeUser(user),
      subscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan.name,
            rateLimit: subscription.plan.rateLimit,
            endTime: subscription.endTime,
            remainingTime: remainingTimeText(subscription.endTime),
          }
        : null,
    });
  } catch (error) {
    logger.error(`❌ getMe: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get profile" });
  }
};
