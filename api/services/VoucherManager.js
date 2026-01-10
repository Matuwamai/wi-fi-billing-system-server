// services/VoucherManager.js
import prisma from "../config/db.js";
import crypto from "crypto";
import { addHours, addDays, addWeeks, addMonths } from "date-fns";
import { RouterSessionManager } from "./routerSessionService.js";

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
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function generateTempMac() {
  // Use 02:00:00 prefix (locally administered MAC)
  const randomBytes = Array.from({ length: 3 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()
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
  /**
   * Create voucher with subscription (Admin function)
   */
  createVoucher: async ({
    planId,
    quantity = 1,
    expiresInDays = 30,
    adminId,
  }) => {
    try {
      // Get plan details
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
      });

      if (!plan) throw new Error("Plan not found");

      const vouchers = [];
      const expiryDate = addDays(new Date(), expiresInDays);

      // Create multiple vouchers if quantity > 1
      for (let i = 0; i < quantity; i++) {
        let voucherCode;
        let isUnique = false;

        // Ensure unique voucher code
        while (!isUnique) {
          voucherCode = generateVoucherCode();
          const existing = await prisma.voucher.findUnique({
            where: { code: voucherCode },
          });
          isUnique = !existing;
        }

        // Create voucher in database
        const voucher = await prisma.voucher.create({
          data: {
            code: voucherCode,
            planId: plan.id,
            status: "UNUSED",
            expiresAt: expiryDate,
            createdBy: adminId,
          },
          include: {
            plan: true,
          },
        });

        vouchers.push(voucher);
        console.log(`✅ Voucher created: ${voucherCode} (Plan: ${plan.name})`);
      }

      return vouchers;
    } catch (error) {
      console.error("❌ Voucher creation error:", error.message);
      throw error;
    }
  },

  /**
   * Redeem voucher and create subscription with temp MAC
   */
  redeemVoucher: async ({
    voucherCode,
    phone,
    macAddress,
    ipAddress,
    deviceName,
  }) => {
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
        // Create new user with TEMP MAC
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            username: username,
            password: password,
            deviceName: deviceName,
            macAddress: generateTempMac(), // Start with TEMP MAC
            isTempMac: true,
            status: "ACTIVE",
            role: "USER",
          },
        });

        console.log(
          `✅ Created user: ${username} with TEMP MAC: ${user.macAddress}`
        );
      } else if (!user.username || !user.password) {
        // Update existing user with credentials and temp MAC if needed
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            username: username,
            password: password,
            deviceName: deviceName,
            macAddress: user.macAddress || generateTempMac(),
            isTempMac: user.macAddress ? user.isTempMac : true,
          },
        });

        console.log(`✅ Updated user: ${username}`);
      }

      // Calculate subscription end time
      const plan = voucher.plan;
      const endTime = calculateEndTime(plan);

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

      // Create initial router session
      await prisma.routerSession.create({
        data: {
          userId: user.id,
          planId: plan.id,
          subscriptionId: subscription.id,
          macAddress: user.macAddress,
          ipAddress: ipAddress,
          status: "PENDING", // Will become ACTIVE when real MAC is detected
          loginTime: new Date(),
        },
      });

      console.log(`✅ Voucher redeemed: ${voucherCode} by ${username}`);
      console.log(
        `📱 TEMP MAC assigned: ${user.macAddress} (will be updated on first login)`
      );

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
          macAddress: user.macAddress,
          isTempMac: user.isTempMac,
        },
        subscription: {
          id: subscription.id,
          planName: plan.name,
          startTime: subscription.startTime,
          endTime: endTime,
          durationValue: plan.durationValue,
          durationType: plan.durationType,
        },
        instructions: {
          step1: "Connect to the WiFi network",
          step2: "Open any website in your browser",
          step3: `Login with username: ${user.username} and password: ${user.password}`,
          step4: "After logging in ONCE, future connections will be automatic!",
          note: "Your device MAC will be detected automatically on first login",
        },
      };
    } catch (error) {
      console.error("❌ Voucher redemption error:", error.message);
      throw error;
    }
  },

  checkVoucher: async (voucherCode) => {
    try {
      const voucher = await prisma.voucher.findUnique({
        where: { code: voucherCode.toUpperCase().replace(/\s/g, "") },
        include: {
          plan: true,
        },
      });

      if (!voucher) {
        return { valid: false, message: "Invalid voucher code" };
      }

      if (voucher.status === "USED") {
        return {
          valid: false,
          message: "Voucher has already been used",
          usedAt: voucher.usedAt,
        };
      }

      if (
        voucher.status === "EXPIRED" ||
        new Date() > new Date(voucher.expiresAt)
      ) {
        return {
          valid: false,
          message: "Voucher has expired",
          expiresAt: voucher.expiresAt,
        };
      }

      return {
        valid: true,
        voucher: {
          code: voucher.code,
          plan: voucher.plan,
          expiresAt: voucher.expiresAt,
        },
        message: `Valid voucher for ${voucher.plan.name}`,
      };
    } catch (error) {
      console.error("❌ Voucher check error:", error.message);
      throw error;
    }
  },

  /**
   * List all vouchers (Admin function)
   */
  listVouchers: async ({ status, planId, page = 1, limit = 50 }) => {
    try {
      const where = {};
      if (status) where.status = status;
      if (planId) where.planId = planId;

      const [vouchers, total] = await Promise.all([
        prisma.voucher.findMany({
          where,
          include: {
            plan: true,
            user: {
              select: {
                id: true,
                phone: true,
                username: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.voucher.count({ where }),
      ]);

      return {
        vouchers,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ List vouchers error:", error.message);
      throw error;
    }
  },

  /**
   * Expire unused vouchers
   */
  expireVouchers: async () => {
    try {
      const result = await prisma.voucher.updateMany({
        where: {
          status: "UNUSED",
          expiresAt: { lt: new Date() },
        },
        data: {
          status: "EXPIRED",
        },
      });

      console.log(`✅ Expired ${result.count} unused vouchers`);
      return result;
    } catch (error) {
      console.error("❌ Expire vouchers error:", error.message);
      throw error;
    }
  },

  /**
   * Delete voucher (Admin function)
   */
  deleteVoucher: async (voucherId) => {
    try {
      const voucher = await prisma.voucher.findUnique({
        where: { id: voucherId },
      });

      if (!voucher) throw new Error("Voucher not found");

      if (voucher.status === "USED") {
        throw new Error("Cannot delete used voucher");
      }

      await prisma.voucher.delete({
        where: { id: voucherId },
      });

      console.log(`✅ Voucher deleted: ${voucher.code}`);
      return { success: true, message: "Voucher deleted successfully" };
    } catch (error) {
      console.error("❌ Delete voucher error:", error.message);
      throw error;
    }
  },
};
