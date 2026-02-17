// controllers/subscriptionController.js
import prisma from "../config/db.js";
import {
  expireSubscription,
  expireStaleSubscriptions,
  getUserSubscriptions,
  getActiveSubscription,
} from "../services/subscriptionService.js";
import { RadiusManager } from "../services/RadiusManager.js";
import logger from "../utils/logger.js";

/**
 * GET /api/subscriptions
 * Admin: list all subscriptions with pagination
 */
export const listSubscriptions = async (req, res) => {
  try {
    const { status, userId, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (userId) where.userId = Number(userId);

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, phone: true, deviceName: true },
          },
          plan: { select: { id: true, name: true, rateLimit: true } },
        },
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.subscription.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: subscriptions });
  } catch (error) {
    logger.error(`❌ listSubscriptions: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list subscriptions" });
  }
};

/**
 * GET /api/subscriptions/my
 * User: get own subscriptions
 */
export const getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const subs = await getUserSubscriptions(userId);
    return res.status(200).json({ success: true, data: subs });
  } catch (error) {
    logger.error(`❌ getMySubscriptions: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch subscriptions" });
  }
};

/**
 * GET /api/subscriptions/my/active
 * User: get current active subscription
 */
export const getMyActiveSubscription = async (req, res) => {
  try {
    const sub = await getActiveSubscription(req.user.id);
    if (!sub) {
      return res
        .status(404)
        .json({ success: false, message: "No active subscription" });
    }
    return res.status(200).json({ success: true, data: sub });
  } catch (error) {
    logger.error(`❌ getMyActiveSubscription: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch subscription" });
  }
};

/**
 * GET /api/subscriptions/:id
 * Get a single subscription by ID
 */
export const getSubscription = async (req, res) => {
  try {
    const sub = await prisma.subscription.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        user: { select: { id: true, username: true, phone: true } },
        plan: true,
        payment: true,
      },
    });

    if (!sub) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    // Non-admin users can only see their own
    if (req.user.role !== "ADMIN" && sub.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.status(200).json({ success: true, data: sub });
  } catch (error) {
    logger.error(`❌ getSubscription: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch subscription" });
  }
};

/**
 * POST /api/subscriptions/:id/expire
 * Admin: manually expire a subscription and remove RADIUS access
 */
export const manualExpire = async (req, res) => {
  try {
    const result = await expireSubscription(Number(req.params.id));
    return res
      .status(200)
      .json({ success: true, message: "Subscription expired", ...result });
  } catch (error) {
    logger.error(`❌ manualExpire: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/subscriptions/expire-stale
 * Admin: batch-expire all overdue subscriptions (also called by cron)
 */
export const runExpireStale = async (req, res) => {
  try {
    const result = await expireStaleSubscriptions();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error(`❌ runExpireStale: ${error.message}`);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to expire stale subscriptions",
      });
  }
};

/**
 * GET /api/subscriptions/:id/usage
 * Get data usage & active session info for a subscription's user
 */
export const getSubscriptionUsage = async (req, res) => {
  try {
    const sub = await prisma.subscription.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: true },
    });

    if (!sub) {
      return res
        .status(404)
        .json({ success: false, message: "Subscription not found" });
    }

    if (req.user.role !== "ADMIN" && sub.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const [usage, sessions, macInfo] = await Promise.all([
      RadiusManager.getUserDataUsage(sub.user.username, sub.startTime),
      RadiusManager.getActiveSessions(sub.user.username),
      RadiusManager.getActiveMacAddress(sub.user.username),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        subscription: {
          id: sub.id,
          status: sub.status,
          startTime: sub.startTime,
          endTime: sub.endTime,
        },
        usage,
        activeSessions: sessions.length,
        device: macInfo,
      },
    });
  } catch (error) {
    logger.error(`❌ getSubscriptionUsage: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get usage" });
  }
};
