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
   * Redeem voucher and start session (User function)
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
        where: { code: voucherCode.toUpperCase().replace(/\s/g, "") },
        include: {
          plan: true,
        },
      });

      if (!voucher) throw new Error("Invalid voucher code");

      // Check voucher status...
      // ... (keep existing validation code)

      // Generate a temporary MAC if not provided
      let tempMac = macAddress;
      let isTempMac = false;

      if (!tempMac) {
        // Generate temp MAC: 02:00:00:XX:XX:XX (locally administered)
        const randomBytes = Math.floor(Math.random() * 65536)
          .toString(16)
          .padStart(4, "0");
        tempMac = `02:00:00:${randomBytes.substring(
          0,
          2
        )}:${randomBytes.substring(2, 4)}:00`;
        isTempMac = true;
        console.log(`📱 Generated temp MAC for voucher user: ${tempMac}`);
      }

      // Find or create user
      let user;

      if (phone || macAddress) {
        // Try to find existing user (including by temp MAC)
        user = await prisma.user.findFirst({
          where: {
            OR: [
              ...(phone ? [{ phone }] : []),
              ...(macAddress ? [{ macAddress }] : []),
              ...(tempMac ? [{ macAddress: tempMac }] : []),
            ],
          },
        });
      }

      if (!user) {
        // Create new user with temp MAC
        user = await prisma.user.create({
          data: {
            phone,
            macAddress: tempMac,
            deviceName,
            isGuest: true,
            status: "ACTIVE",
            isTempMac: isTempMac, // Add this field to track
            lastMacUpdate: new Date(),
          },
        });
        console.log(
          `🆕 Created user ${user.id} with ${
            isTempMac ? "TEMP" : "REAL"
          } MAC: ${tempMac}`
        );
      } else {
        // Update existing user with temp MAC if needed
        const updateData = {
          ...(deviceName && { deviceName }),
          ...(!user.macAddress && { macAddress: tempMac }),
          isTempMac: isTempMac || user.isTempMac,
          lastMacUpdate: new Date(),
        };

        await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        console.log(`♻️ Updated user ${user.id} with MAC: ${tempMac}`);
      }

      // Calculate subscription end time
      const startTime = new Date();
      const endTime = calculateEndTime(voucher.plan);

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: voucher.plan.id,
          startTime,
          endTime,
          status: "ACTIVE",
        },
      });

      console.log(`✅ Subscription created: ${subscription.id}`);

      // Mark voucher as used
      await prisma.voucher.update({
        where: { id: voucher.id },
        data: {
          status: "USED",
          usedBy: user.id,
          usedAt: new Date(),
          subscriptionId: subscription.id,
        },
      });

      console.log(`✅ Voucher marked as used: ${voucherCode}`);

      // Start router session
      const session = await RouterSessionManager.startAutomatic({
        subscriptionId: subscription.id,
        macAddress,
        ipAddress,
      });

      return {
        success: true,
        subscription,
        session,
        user: {
          id: user.id,
          phone: user.phone,
          username: user.username,
          macAddress: tempMac,
          isTempMac,
        },
        plan: voucher.plan,
        message: `Voucher redeemed successfully! You have ${
          voucher.plan.durationValue
        } ${voucher.plan.durationType.toLowerCase()}(s) of internet access.`,
      };
    } catch (error) {
      console.error("❌ Voucher redemption error:", error.message);
      throw error;
    }
  },

  /**
   * Check voucher validity without redeeming
   */
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
