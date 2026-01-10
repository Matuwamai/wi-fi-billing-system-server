// routes/voucher.routes.js
import express from "express";
import { VoucherManager } from "../services/VoucherManager.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

/**
 * Admin: Create vouchers
 * POST /api/vouchers/create
 * Body: { planId, quantity, expiresInDays, adminId }
 */
router.post(
  "/create",
  authenticate,
  authorizeRoles("ADMIN"),
  async (req, res) => {
    try {
      const { planId, quantity = 1, expiresInDays = 30, adminId } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          message: "Plan ID is required",
        });
      }

      console.log(`📝 Creating ${quantity} voucher(s) for plan ${planId}`);

      const vouchers = await VoucherManager.createVoucher({
        planId: parseInt(planId),
        quantity: parseInt(quantity),
        expiresInDays: parseInt(expiresInDays),
        adminId: adminId ? parseInt(adminId) : null,
      });

      res.json({
        success: true,
        message: `${vouchers.length} voucher(s) created successfully`,
        vouchers: vouchers.map((v) => ({
          code: v.code,
          plan: v.plan.name,
          expiresAt: v.expiresAt,
        })),
      });
    } catch (error) {
      console.error("❌ Create voucher error:", error.message);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create voucher",
      });
    }
  }
);

/**
 * User: Check voucher validity
 * GET /api/vouchers/check/:code
 */
router.get("/check/:code", async (req, res) => {
  try {
    const { code } = req.params;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Voucher code is required",
      });
    }

    const result = await VoucherManager.checkVoucher(code);

    res.json(result);
  } catch (error) {
    console.error("❌ Check voucher error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to check voucher",
    });
  }
});

/**
 * User: Redeem voucher
 * POST /api/vouchers/redeem
 * Body: { voucherCode, phone?, macAddress, ipAddress?, deviceName? }
 */
router.post("/redeem", async (req, res) => {
  try {
    const { voucherCode, phone, ipAddress, deviceName, userAgent } = req.body;

    if (!voucherCode) {
      return res.status(400).json({
        success: false,
        message: "Voucher code is required",
      });
    }

    if (!deviceName) {
      return res.status(400).json({
        success: false,
        message: "Device name is required",
      });
    }

    console.log(`🎫 Redeeming voucher: ${voucherCode} for ${deviceName}`);

    // Extract possible MAC from user agent or other headers
    let macAddress = null;

    // Try to get client info
    const forwardedFor = req.headers["x-forwarded-for"] || req.ip;
    const clientInfo = {
      ip: ipAddress || forwardedFor,
      userAgent: userAgent || req.headers["user-agent"],
      deviceName,
    };

    console.log("📱 Client info:", clientInfo);

    const result = await VoucherManager.redeemVoucher({
      voucherCode,
      phone,
      macAddress: null, // Will be generated as temp
      ipAddress: clientInfo.ip,
      deviceName,
    });

    // Return the temp MAC to the client
    res.json({
      ...result,
      instructions: result.user.isTempMac
        ? "Your temporary access has been created. Connect to WiFi using any credentials and your real MAC will be detected automatically."
        : "Access granted! You can now connect to the WiFi.",
    });
  } catch (error) {
    console.error("❌ Redeem voucher error:", error.message);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to redeem voucher",
    });
  }
});

/**
 * Admin: List all vouchers
 * GET /api/vouchers/list?status=UNUSED&planId=1&page=1&limit=50
 */
router.get("/list", authenticate, authorizeRoles("ADMIN"), async (req, res) => {
  try {
    const { status, planId, page = 1, limit = 50 } = req.query;

    const result = await VoucherManager.listVouchers({
      status,
      planId: planId ? parseInt(planId) : undefined,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("❌ List vouchers error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to list vouchers",
    });
  }
});

/**
 * Admin: Delete voucher
 * DELETE /api/vouchers/:id
 */
router.delete(
  "/:id",
  authenticate,
  authorizeRoles("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Voucher ID is required",
        });
      }

      const result = await VoucherManager.deleteVoucher(parseInt(id));

      res.json(result);
    } catch (error) {
      console.error("❌ Delete voucher error:", error.message);
      res.status(400).json({
        success: false,
        message: error.message || "Failed to delete voucher",
      });
    }
  }
);

/**
 * Admin: Manually expire old vouchers
 * POST /api/vouchers/expire
 */
router.post(
  "/expire",
  authenticate,
  authorizeRoles("ADMIN"),
  async (req, res) => {
    try {
      const result = await VoucherManager.expireVouchers();

      res.json({
        success: true,
        message: `Expired ${result.count} vouchers`,
        count: result.count,
      });
    } catch (error) {
      console.error("❌ Expire vouchers error:", error.message);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to expire vouchers",
      });
    }
  }
);

export default router;
