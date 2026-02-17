// controllers/userController.js
import prisma from "../config/db.js";
import bcrypt from "bcryptjs";
import { RadiusManager } from "../services/RadiusManager.js";
import { getActiveSubscription } from "../services/subscriptionService.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const safeUser = (user) => ({
  id: user.id,
  phone: user.phone,
  username: user.username,
  deviceName: user.deviceName,
  role: user.role,
  isGuest: user.isGuest,
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
});

// ─────────────────────────────────────────────
// ADMIN CONTROLLERS
// ─────────────────────────────────────────────

/**
 * GET /api/users
 * Admin: list all users with optional search & pagination
 */
export const listUsers = async (req, res) => {
  try {
    const { search, status, role, isGuest, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (role) where.role = role;
    if (isGuest !== undefined) where.isGuest = isGuest === "true";

    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { username: { contains: search } },
        { deviceName: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          username: true,
          deviceName: true,
          role: true,
          isGuest: true,
          status: true,
          lastLogin: true,
          createdAt: true,
          _count: {
            select: { subscriptions: true, payments: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: users });
  } catch (error) {
    logger.error(`❌ listUsers: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list users" });
  }
};

/**
 * GET /api/users/:id
 * Get full user profile with subscription & RADIUS info
 */
export const getUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    // Non-admin users can only view their own profile
    if (req.user.role !== "ADMIN" && req.user.id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        payments: {
          orderBy: { transactionDate: "desc" },
          take: 5,
        },
      },
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Get RADIUS info if user has a username
    let radiusInfo = null;
    if (user.username) {
      try {
        const [sessions, usage] = await Promise.all([
          RadiusManager.getActiveSessions(user.username),
          RadiusManager.getUserDataUsage(user.username),
        ]);
        radiusInfo = { activeSessions: sessions.length, usage };
      } catch {
        // RADIUS might not have this user yet
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        ...safeUser(user),
        subscriptions: user.subscriptions,
        recentPayments: user.payments,
        radius: radiusInfo,
      },
    });
  } catch (error) {
    logger.error(`❌ getUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get user" });
  }
};

/**
 * PATCH /api/users/:id
 * Update user info (admin can update any, user can only update self)
 */
export const updateUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (req.user.role !== "ADMIN" && req.user.id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { phone, username, deviceName, password, status, role } = req.body;

    // Only admins can change role or status
    if ((status || role) && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only admins can change status or role",
      });
    }

    const updateData = {};
    if (phone) updateData.phone = phone;
    if (username) updateData.username = username;
    if (deviceName) updateData.deviceName = deviceName;
    if (status) updateData.status = status;
    if (role) updateData.role = role;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    logger.info(`✏️ User updated: ${userId} by admin=${req.user.id}`);

    return res.status(200).json({ success: true, data: safeUser(updated) });
  } catch (error) {
    logger.error(`❌ updateUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update user" });
  }
};

/**
 * POST /api/users/:id/block
 * Admin: block a user and remove their RADIUS access
 */
export const blockUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { status: "BLOCKED" },
    });

    // Remove RADIUS access
    if (user.username) {
      await RadiusManager.deleteRadiusUser(user.username);
      logger.info(
        `🚫 RADIUS access removed for blocked user: ${user.username}`,
      );
    }

    logger.info(`🔒 User blocked: ${userId}`);
    return res
      .status(200)
      .json({ success: true, message: "User blocked and access removed" });
  } catch (error) {
    logger.error(`❌ blockUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to block user" });
  }
};

/**
 * POST /api/users/:id/unblock
 * Admin: unblock a user
 */
export const unblockUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE" },
    });

    logger.info(`🔓 User unblocked: ${userId}`);
    return res.status(200).json({ success: true, message: "User unblocked" });
  } catch (error) {
    logger.error(`❌ unblockUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to unblock user" });
  }
};

/**
 * DELETE /api/users/:id
 * Admin: delete user and all associated RADIUS data
 */
export const deleteUser = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Remove RADIUS access first
    if (user.username) {
      await RadiusManager.deleteRadiusUser(user.username);
    }

    // Delete user (cascade will handle subscriptions/payments via FK)
    await prisma.user.delete({ where: { id: userId } });

    logger.info(`🗑️ User deleted: ${userId}`);
    return res.status(200).json({ success: true, message: "User deleted" });
  } catch (error) {
    logger.error(`❌ deleteUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete user" });
  }
};

/**
 * GET /api/users/:id/status
 * Check a user's connection status (active subscription + RADIUS session)
 * Used by the captive portal to verify access
 */
export const getUserStatus = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const subscription = await getActiveSubscription(userId);

    let radiusSessions = [];
    let device = null;
    if (user.username) {
      [radiusSessions, device] = await Promise.all([
        RadiusManager.getActiveSessions(user.username),
        RadiusManager.getActiveMacAddress(user.username),
      ]);
    }

    const isConnected = subscription !== null && radiusSessions.length > 0;

    return res.status(200).json({
      success: true,
      data: {
        userId,
        username: user.username,
        status: user.status,
        isConnected,
        subscription: subscription
          ? {
              id: subscription.id,
              plan: subscription.plan.name,
              endTime: subscription.endTime,
            }
          : null,
        activeSessions: radiusSessions.length,
        device,
      },
    });
  } catch (error) {
    logger.error(`❌ getUserStatus: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get user status" });
  }
};
