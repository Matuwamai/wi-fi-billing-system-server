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

  /**
   * Redeem voucher and create subscription with temp MAC
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
   * Redeem voucher and create subscription with device-based username
   */
  redeemVoucher: async ({
    voucherCode,
    phone,
    macAddress,
    ipAddress,
    deviceName,
    deviceHostname,
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

      // Generate temp token for device matching (valid for 30 minutes)
      const tempToken = Math.random()
        .toString(36)
        .substring(2, 15)
        .toUpperCase();
      const tempTokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Generate username from device hostname or create one
      let username = `temp_${tempToken}`; // Start with temp username
      let finalUsername = username; // Will be updated when real device connects

      // Also prepare a clean version of device hostname for later
      let cleanDeviceHostname = null;
      if (deviceHostname && deviceHostname !== "unknown") {
        cleanDeviceHostname = deviceHostname
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, "")
          .substring(0, 30);
      }

      console.log(
        `🆔 Temp username: ${username}, Device hostname: ${
          cleanDeviceHostname || "none"
        }`
      );

      // Find or create user
      let user = null;

      // Stage 1: Try to find by phone
      if (phone) {
        user = await prisma.user.findUnique({ where: { phone } });
        if (user) {
          console.log(`✅ Found existing user by phone: ${user.username}`);
        }
      }

      // Stage 2: Try to find by device hostname
      if (!user && cleanDeviceHostname) {
        user = await prisma.user.findFirst({
          where: {
            username: cleanDeviceHostname,
            isTempMac: true, // Only match temp users
          },
        });
        if (user) {
          console.log(
            `✅ Found existing user by device hostname: ${user.username}`
          );
        }
      }

      const password = generateRandomPassword(8);

      if (!user) {
        // Create new user with TEMP credentials
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            username: username, // Start with temp username
            password: password,
            deviceName: deviceName || "Unknown Device",
            macAddress: macAddress || generateTempMac(),
            isTempMac: true, // Always temp initially
            status: "ACTIVE",
            role: "USER",
            tempAccessToken: tempToken,
            tempTokenExpiry: tempTokenExpiry,
          },
        });

        console.log(
          `✅ Created user with temp token: ${tempToken}, Username: ${username}`
        );
      } else {
        // Update existing user
        const updateData = {
          password: password,
          deviceName: deviceName || user.deviceName,
          tempAccessToken: tempToken,
          tempTokenExpiry: tempTokenExpiry,
          updatedAt: new Date(),
        };

        // Update MAC if provided
        if (macAddress) {
          updateData.macAddress = macAddress;
          updateData.isTempMac = false;
        }

        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });

        console.log(
          `✅ Updated user ${user.username} with temp token: ${tempToken}`
        );
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

      // Create router session with temp MAC
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

      console.log(`✅ Voucher redeemed: ${voucherCode} for ${user.username}`);
      console.log(
        `📱 Temp token: ${tempToken} (expires: ${tempTokenExpiry.toISOString()})`
      );

      // Send credentials via SMS if phone provided
      if (phone) {
        await sendCredentialsSMS(phone, {
          username: user.username, // This is temp_ABC123
          password: user.password,
          plan: plan.name,
          expiryDate: endTime,
          tempToken: tempToken, // Include in SMS
          instructions:
            "Your device will be automatically detected when you connect to WiFi",
        });
      }

      return {
        success: true,
        message: "Voucher redeemed successfully",
        tempToken: tempToken, // Send to frontend
        credentials: {
          username: user.username, // temp_ABC123
          password: user.password,
          ssid: "Your-WiFi-Network", // You should define this
          tempToken: tempToken,
        },
        user: {
          id: user.id,
          username: user.username,
          password: user.password,
          macAddress: user.macAddress,
          isTempMac: user.isTempMac,
          hasRealDeviceName: !!cleanDeviceHostname,
          suggestedRealUsername: cleanDeviceHostname,
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
          step1: `Connect to WiFi: Your-WiFi-Network`,
          step2: `Username: ${user.username}`,
          step3: `Password: ${user.password}`,
          step4: "Your device will be automatically recognized",
          step5: `Temporary code: ${tempToken} (for automatic matching)`,
          note: "After first login, your device name will be used as your username",
        },
        nextSteps: {
          autoDetection:
            "When you connect to WiFi, your device will be automatically detected",
          usernameUpdate: `Your username will change to "${
            cleanDeviceHostname || "your-device-name"
          }" after detection`,
          validity: `Access valid until: ${endTime.toLocaleDateString()}`,
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
