// services/VoucherManager.js
import prisma from "../config/db.js";
import RadiusManager from "./RadiusManager.js";
import { addHours, addDays, addWeeks, addMonths } from "date-fns";

// Helper to generate unique voucher code
const generateVoucherCode = () => {
  // Format: XXXX-XXXX-XXXX (12 characters, easy to read)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude similar chars (0,O,1,I)
  let code = "";

  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
};

// Helper to calculate end time based on plan
const calculateEndTime = (plan) => {
  const now = new Date();

  switch (plan.durationType) {
    case "MINUTE":
      return new Date(now.getTime() + plan.durationValue * 60000);
    case "HOUR":
      return addHours(now, plan.durationValue);
    case "DAY":
      return addDays(now, plan.durationValue);
    case "WEEK":
      return addWeeks(now, plan.durationValue);
    case "MONTH":
      return addMonths(now, plan.durationValue);
    default:
      return addHours(now, 1);
  }
};

// Helper: Generate random password
function generateRandomPassword(length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function generateTempMac() {
  // Use 02:00:00 prefix (locally administered MAC)
  const randomBytes = Array.from({ length: 3 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase(),
  ).join(":");

  return `02:00:00:${randomBytes}`;
}

// Helper: Send SMS with credentials
async function sendCredentialsSMS(phone, credentials) {
  const message = `
WiFi Access Activated!

Username: ${credentials.username}
Password: ${credentials.password}

Plan: ${credentials.plan}
Valid until: ${credentials.expiryDate.toLocaleDateString()}

Instructions:
1. Connect to WiFi
2. Open browser and login ONCE
3. Future connections are automatic!

Enjoy your internet!
  `.trim();

  console.log(`📱 SMS to ${phone}:`, message);
}

export const VoucherManager = {
  // services/VoucherManager.js

  // ... existing methods (redeemVoucher, expireSubscription) ...

  /**
   * Create new vouchers
   */
  createVoucher: async ({ planId, quantity, expiresInDays, adminId }) => {
    try {
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
      });

      if (!plan) {
        throw new Error("Plan not found");
      }

      const vouchers = [];
      const expiresAt = addDays(new Date(), expiresInDays);

      for (let i = 0; i < quantity; i++) {
        const code = generateVoucherCode();

        // Ensure code is unique
        let existing = await prisma.voucher.findUnique({ where: { code } });
        while (existing) {
          code = generateVoucherCode();
          existing = await prisma.voucher.findUnique({ where: { code } });
        }

        const voucher = await prisma.voucher.create({
          data: {
            code,
            planId,
            expiresAt,
            status: "UNUSED",
            createdBy: adminId,
          },
          include: { plan: true },
        });

        vouchers.push(voucher);
      }

      return vouchers;
    } catch (error) {
      console.error("❌ Create voucher error:", error);
      throw error;
    }
  },

  /**
   * Check voucher validity
   */
  checkVoucher: async (code) => {
    try {
      const voucher = await prisma.voucher.findUnique({
        where: { code },
        include: { plan: true },
      });

      if (!voucher) {
        return {
          success: false,
          message: "Invalid voucher code",
          valid: false,
        };
      }

      const now = new Date();
      let valid = true;
      let message = "Voucher is valid";

      if (voucher.status === "USED") {
        valid = false;
        message = "Voucher has already been used";
      } else if (voucher.status === "EXPIRED" || now > voucher.expiresAt) {
        valid = false;
        message = "Voucher has expired";
      }

      return {
        success: valid,
        valid,
        message,
        voucher: valid
          ? {
              code: voucher.code,
              plan: voucher.plan.name,
              expiresAt: voucher.expiresAt,
              status: voucher.status,
            }
          : null,
      };
    } catch (error) {
      console.error("❌ Check voucher error:", error);
      throw error;
    }
  },

  /**
   * List vouchers with filtering and pagination
   */
  listVouchers: async ({ status, planId, page = 1, limit = 50 }) => {
    try {
      const where = {};

      if (status) {
        where.status = status;
      }

      if (planId) {
        where.planId = planId;
      }

      const skip = (page - 1) * limit;

      const [vouchers, total] = await Promise.all([
        prisma.voucher.findMany({
          where,
          include: {
            plan: true,
            user: {
              select: { id: true, username: true, phone: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.voucher.count({ where }),
      ]);

      return {
        vouchers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ List vouchers error:", error);
      throw error;
    }
  },

  /**
   * Delete a voucher
   */
  deleteVoucher: async (id) => {
    try {
      const voucher = await prisma.voucher.findUnique({
        where: { id },
      });

      if (!voucher) {
        throw new Error("Voucher not found");
      }

      if (voucher.status === "USED") {
        throw new Error("Cannot delete a used voucher");
      }

      await prisma.voucher.delete({
        where: { id },
      });

      return {
        success: true,
        message: "Voucher deleted successfully",
      };
    } catch (error) {
      console.error("❌ Delete voucher error:", error);
      throw error;
    }
  },

  /**
   * Manually expire old vouchers
   */
  expireVouchers: async () => {
    try {
      const now = new Date();

      const result = await prisma.voucher.updateMany({
        where: {
          status: "UNUSED",
          expiresAt: { lt: now },
        },
        data: {
          status: "EXPIRED",
        },
      });

      return {
        success: true,
        count: result.count,
      };
    } catch (error) {
      console.error("❌ Expire vouchers error:", error);
      throw error;
    }
  },

  /**
   * Redeem voucher - Now creates RADIUS user instead of sync
   */
  redeemVoucher: async ({ voucherCode, phone, deviceName }) => {
    try {
      // Find voucher
      const voucher = await prisma.voucher.findUnique({
        where: { code: voucherCode },
        include: { plan: true },
      });

      if (!voucher) {
        throw new Error("Invalid voucher code");
      }

      if (voucher.status === "USED") {
        throw new Error("Voucher has already been used");
      }

      if (voucher.status === "EXPIRED" || new Date() > voucher.expiresAt) {
        throw new Error("Voucher has expired");
      }

      // Find or create user
      let user = phone
        ? await prisma.user.findUnique({ where: { phone } })
        : null;

      const username =
        user?.username || `user_${Math.random().toString(36).substr(2, 9)}`;
      const password = generateRandomPassword(8);

      if (!user) {
        // Create new user
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            username: username,
            password: password,
            deviceName: deviceName,
            status: "ACTIVE",
            role: "USER",
          },
        });

        console.log(`✅ Created user: ${username}`);
      } else if (!user.username || !user.password) {
        // Update existing user
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            username: username,
            password: password,
            deviceName: deviceName,
          },
        });
      }

      // Calculate subscription end time
      const plan = voucher.plan;
      const endTime = calculateEndTime(plan.durationType, plan.durationValue);

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          startTime: new Date(),
          endTime: endTime,
          status: "ACTIVE",
        },
      });

      // **KEY CHANGE: Create RADIUS user instead of temp MAC**
      const planProfile = getPlanProfile(plan);
      await RadiusManager.createRadiusUser({
        username: user.username,
        password: user.password,
        planProfile: planProfile,
      });

      // Mark voucher as used
      await prisma.voucher.update({
        where: { id: voucher.id },
        data: {
          status: "USED",
          usedAt: new Date(),
          usedBy: user.id,
          subscriptionId: subscription.id,
        },
      });

      console.log(`✅ Voucher redeemed: ${voucherCode} by ${username}`);

      // Send credentials via SMS if phone provided
      if (phone) {
        await sendCredentialsSMS(phone, {
          username: user.username,
          password: user.password,
          plan: plan.name,
          expiryDate: endTime,
        });
      }

      return {
        success: true,
        message: "Voucher redeemed successfully",
        user: {
          id: user.id,
          username: user.username,
          password: user.password,
        },
        subscription: {
          id: subscription.id,
          planName: plan.name,
          startTime: subscription.startTime,
          endTime: endTime,
          speedLimit: planProfile.rateLimit,
        },
        instructions: {
          step1: "Connect to the WiFi network",
          step2: "Open any website in your browser",
          step3: `Login with username: ${user.username} and password: ${user.password}`,
          step4: "Enjoy your internet!",
          note: "Your device will be automatically recognized on login",
        },
      };
    } catch (error) {
      console.error("❌ Voucher redemption error:", error.message);
      throw error;
    }
  },

  /**
   * Handle subscription expiry - Remove RADIUS user
   */
  expireSubscription: async (subscriptionId) => {
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { user: true },
      });

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      // Update subscription status
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { status: "EXPIRED" },
      });

      // **Remove RADIUS user**
      await RadiusManager.deleteRadiusUser(subscription.user.username);

      console.log(`✅ Subscription expired: ${subscription.user.username}`);

      return { success: true };
    } catch (error) {
      console.error("❌ Subscription expiry error:", error);
      throw error;
    }
  },
};

// Helper: Get plan profile configuration
function getPlanProfile(plan) {
  const profiles = {
    // Speed limits in format: "download/upload"
    "1 Hour": { rateLimit: "5M/5M", sessionTimeout: 3600 },
    "1 Day": { rateLimit: "10M/10M", sessionTimeout: 86400 },
    "1 Week": { rateLimit: "10M/10M", sessionTimeout: null },
    "1 Month": { rateLimit: "15M/15M", sessionTimeout: null },
  };

  return profiles[plan.name] || { rateLimit: "10M/10M", sessionTimeout: null };
}
