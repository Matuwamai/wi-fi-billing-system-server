// controllers/radiusController.js
import prisma from "../config/db.js";
import { RadiusManager } from "../services/RadiusManager.js";
import logger from "../utils/logger.js";

/**
 * GET /api/radius/users
 * Admin: list all RADIUS users (from radcheck)
 */
export const listRadiusUsers = async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (search) where.username = { contains: search };

    const [users, total] = await Promise.all([
      prisma.radCheck.findMany({
        where,
        orderBy: { id: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.radCheck.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: users });
  } catch (error) {
    logger.error(`❌ listRadiusUsers: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list RADIUS users" });
  }
};

/**
 * GET /api/radius/sessions
 * Admin: list active RADIUS sessions (from radacct)
 */
export const listActiveSessions = async (req, res) => {
  try {
    const { username, limit = 50, offset = 0 } = req.query;

    const where = { acctstoptime: null }; // NULL stoptime = still connected
    if (username) where.username = { contains: username };

    const [sessions, total] = await Promise.all([
      prisma.radAcct.findMany({
        where,
        orderBy: { acctstarttime: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.radAcct.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: sessions });
  } catch (error) {
    logger.error(`❌ listActiveSessions: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list sessions" });
  }
};

/**
 * GET /api/radius/sessions/history
 * Admin: full accounting history (all sessions including stopped)
 */
export const getSessionHistory = async (req, res) => {
  try {
    const { username, from, to, limit = 100, offset = 0 } = req.query;

    const where = {};
    if (username) where.username = { contains: username };
    if (from || to) {
      where.acctstarttime = {};
      if (from) where.acctstarttime.gte = new Date(from);
      if (to) where.acctstarttime.lte = new Date(to);
    }

    const [sessions, total] = await Promise.all([
      prisma.radAcct.findMany({
        where,
        orderBy: { acctstarttime: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.radAcct.count({ where }),
    ]);

    return res.status(200).json({ success: true, total, data: sessions });
  } catch (error) {
    logger.error(`❌ getSessionHistory: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get session history" });
  }
};

/**
 * GET /api/radius/users/:username
 * Admin: get a single RADIUS user with their reply attributes & active sessions
 */
export const getRadiusUser = async (req, res) => {
  try {
    const { username } = req.params;

    const [checkAttrs, replyAttrs, activeSessions, usage, device] =
      await Promise.all([
        prisma.radCheck.findMany({ where: { username } }),
        prisma.radReply.findMany({ where: { username } }),
        RadiusManager.getActiveSessions(username),
        RadiusManager.getUserDataUsage(username),
        RadiusManager.getActiveMacAddress(username),
      ]);

    if (!checkAttrs.length) {
      return res
        .status(404)
        .json({ success: false, message: "RADIUS user not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        username,
        checkAttributes: checkAttrs,
        replyAttributes: replyAttrs,
        activeSessions: activeSessions.length,
        usage,
        device,
      },
    });
  } catch (error) {
    logger.error(`❌ getRadiusUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get RADIUS user" });
  }
};

/**
 * POST /api/radius/users/:username/disconnect
 * Admin: disconnect a user's active sessions
 */
export const disconnectUser = async (req, res) => {
  try {
    const { username } = req.params;
    const result = await RadiusManager.disconnectUser(username);
    logger.info(`🔌 Admin disconnected user: ${username}`);
    return res
      .status(200)
      .json({ success: true, message: `${username} disconnected`, ...result });
  } catch (error) {
    logger.error(`❌ disconnectUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to disconnect user" });
  }
};

/**
 * DELETE /api/radius/users/:username
 * Admin: fully remove a RADIUS user (radcheck + radreply)
 */
export const deleteRadiusUser = async (req, res) => {
  try {
    const { username } = req.params;
    const result = await RadiusManager.deleteRadiusUser(username);
    logger.info(`🗑️ Admin deleted RADIUS user: ${username}`);
    return res
      .status(200)
      .json({
        success: true,
        message: `${username} removed from RADIUS`,
        ...result,
      });
  } catch (error) {
    logger.error(`❌ deleteRadiusUser: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete RADIUS user" });
  }
};

/**
 * PATCH /api/radius/users/:username/speed
 * Admin: update speed limit for a user
 * Body: { rateLimit: "5M/5M" }
 */
export const updateUserSpeed = async (req, res) => {
  try {
    const { username } = req.params;
    const { rateLimit } = req.body;

    if (!rateLimit) {
      return res
        .status(400)
        .json({
          success: false,
          message: "rateLimit is required (e.g. '5M/5M')",
        });
    }

    const result = await RadiusManager.updateUserProfile({
      username,
      planProfile: { rateLimit },
    });
    logger.info(`⚡ Speed updated for ${username}: ${rateLimit}`);
    return res
      .status(200)
      .json({ success: true, message: "Speed limit updated", ...result });
  } catch (error) {
    logger.error(`❌ updateUserSpeed: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update speed" });
  }
};

/**
 * GET /api/radius/stats
 * Admin: overall RADIUS statistics
 */
export const getRadiusStats = async (req, res) => {
  try {
    const [totalUsers, activeSessions, totalSessions, recentAuths] =
      await Promise.all([
        prisma.radCheck.count(),
        prisma.radAcct.count({ where: { acctstoptime: null } }),
        prisma.radAcct.count(),
        prisma.radpostauth.findMany({
          orderBy: { authdate: "desc" },
          take: 10,
        }),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeSessions,
        totalSessions,
        recentAuthentications: recentAuths,
      },
    });
  } catch (error) {
    logger.error(`❌ getRadiusStats: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get RADIUS stats" });
  }
};
