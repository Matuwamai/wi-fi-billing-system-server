import prisma from "../config/db.js";
import logger from "../utils/logger.js";
import express from "express";

const router = express.Router();
// Middleware to validate MikroTik API key
const validateMikroTikKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const MIKROTIK_SYNC_KEY =
    process.env.MIKROTIK_SYNC_KEY ||
    "wertyuiopp9876tgvcxsertgvcxzawq2345677777777777";

  if (!MIKROTIK_SYNC_KEY) {
    logger.error("MIKROTIK_SYNC_KEY not set in environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (apiKey !== MIKROTIK_SYNC_KEY) {
    logger.warn(`Unauthorized MikroTik sync attempt from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
};

/**
 * GET /api/mikrotik/sync-simple
 * Simple text format for RouterOS script parsing
 * Format: username|password|profile|comment (one per line)
 */
// Add this optimized version with caching
router.get("/sync-simple", validateMikroTikKey, async (req, res) => {
  try {
    logger.info("MikroTik requesting user sync (simple format)");

    // Get query parameters for optimization
    const lastSync = req.query.last_sync; // Optional: timestamp of last sync
    const routerId = req.query.router_id; // Optional: identify which router

    // Get only active subscriptions
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        endTime: {
          gt: new Date(),
        },
        // Optional: Only get modified since last sync
        ...(lastSync && {
          OR: [
            { updatedAt: { gt: new Date(lastSync) } },
            { user: { updatedAt: { gt: new Date(lastSync) } } },
          ],
        }),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            phone: true,
            password: true,
            macAddress: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
            durationType: true,
            durationValue: true,
          },
        },
      },
      orderBy: {
        user: {
          username: "asc",
        },
      },
    });

    // Format: username|password|profile|comment|mac_address|data_limit|speed_limit
    const lines = activeSubscriptions.map((sub) => {
      const user = sub.user;
      const plan = sub.plan;

      // Use username or phone as login
      const username = user.username || user.phone || `user_${user.id}`;
      const password = user.password || username;

      // Profile name mapping to MikroTik user profiles
      // Map common plan names to MikroTik profile names
      const profileMap = {
        // Hourly plans
        "1 hour": "1hour",
        "1-hour": "1hour",
        hourly: "1hour",
        "1h": "1hour",

        // Daily plans
        "1 day": "1day",
        "1-day": "1day",
        daily: "1day",
        "24h": "1day",

        // Weekly plans
        "1 week": "1week",
        "1-week": "1week",
        weekly: "1week",
        "7 days": "1week",
        "7-days": "1week",

        "2 weeks": "2weeks",
        "2-weeks": "2weeks",
        "14 days": "2weeks",
        "14-days": "2weeks",

        "3 weeks": "3weeks",
        "3-weeks": "3weeks",
        "21 days": "3weeks",
        "21-days": "3weeks",

        // Monthly plans
        "1 month": "1month",
        "1-month": "1month",
        monthly: "1month",
        "30 days": "1month",
        "30-days": "1month",

        // Default fallback
        default: "1hour",
      };

      // Normalize plan name for mapping
      const planName = plan.name.toLowerCase().trim();

      // Get profile from map or use original name (sanitized)
      let profile = profileMap[planName];

      if (!profile) {
        // Try to match with contains logic
        for (const [key, value] of Object.entries(profileMap)) {
          if (planName.includes(key) || key.includes(planName)) {
            profile = value;
            break;
          }
        }

        // If still no match, use sanitized version
        if (!profile) {
          profile = plan.name
            .replace(/\s+/g, "")
            .replace(/-/g, "")
            .toLowerCase();
        }
      }

      // Comment with expiry info
      const expiryDate = sub.endTime.toISOString().split("T")[0];
      const comment = `${user.phone || "N/A"} Exp:${expiryDate}`;

      // Add logging before returning
      console.log("Plan name:", plan.name);
      console.log("Profile being sent:", profile);
      console.log("Full line:", `${username}|${password}|${profile}`);

      return `${username}|${password}|${profile}`;
    });

    // Add header with sync info for debugging
    const syncInfo =
      `# Sync: ${new Date().toISOString()}\n` +
      `# Count: ${lines.length}\n` +
      `# Router: ${routerId || "unknown"}\n`;

    logger.info(
      `📡 Simple sync: ${lines.length} active users sent to MikroTik ${
        routerId ? `(Router: ${routerId})` : ""
      }`
    );

    res
      .type("text/plain")
      .set("X-Sync-Timestamp", new Date().toISOString())
      .set("X-Total-Users", lines.length)
      .send(syncInfo + lines.join("\n"));
  } catch (error) {
    logger.error("❌ Simple sync error:", error);
    res.status(500).send("# ERROR: Sync failed\n");
  }
});

/**
 * GET /api/mikrotik/sync
 * JSON format with detailed user information
 */
router.get("/sync", validateMikroTikKey, async (req, res) => {
  try {
    logger.info("MikroTik requesting user sync (JSON format)");

    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        endTime: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
        plan: true,
      },
    });

    const users = activeSubscriptions.map((sub) => {
      const user = sub.user;
      const plan = sub.plan;

      const username = user.username || user.phone || `user_${user.id}`;
      const password = user.password || username;

      return {
        username: username,
        password: password,
        profile: plan.name.replace(/\s+/g, "-").toLowerCase(),
        comment: `${user.phone || "N/A"} - Expires: ${
          sub.endTime.toISOString().split("T")[0]
        }`,
        plan_name: plan.name,
        expires_at: sub.endTime.toISOString(),
        user_id: user.id,
        subscription_id: sub.id,
      };
    });

    logger.info(`📡 JSON sync: ${users.length} active users sent to MikroTik`);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: users.length,
      users: users,
    });
  } catch (error) {
    logger.error("❌ JSON sync error:", error);
    res.status(500).json({
      success: false,
      error: "Sync failed",
    });
  }
});

/**
 * POST /api/mikrotik/event
 * Receive session events from MikroTik (login, logout, etc.)
 */
router.post("/event", validateMikroTikKey, async (req, res) => {
  try {
    const {
      username,
      event,
      mac_address,
      ip_address,
      bytes_in,
      bytes_out,
      session_time,
    } = req.body;

    logger.info(`📊 MikroTik event: ${event} - User: ${username}`);

    // Find user by username or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: username }, { phone: username }],
      },
    });

    if (!user) {
      logger.warn(`User not found for event: ${username}`);
      return res.json({ success: false, error: "User not found" });
    }

    // Handle different event types
    if (event === "login") {
      // Find active subscription
      const subscription = await prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: "ACTIVE",
          endTime: {
            gt: new Date(),
          },
        },
      });

      if (subscription) {
        // Create router session
        await prisma.routerSession.create({
          data: {
            userId: user.id,
            planId: subscription.planId,
            subscriptionId: subscription.id,
            macAddress: mac_address || null,
            ipAddress: ip_address || null,
            status: "ACTIVE",
            loginTime: new Date(),
          },
        });

        logger.info(`✅ Session started for user: ${username}`);
      }
    } else if (event === "logout" || event === "disconnect") {
      // Find and close active session
      const activeSession = await prisma.routerSession.findFirst({
        where: {
          userId: user.id,
          status: "ACTIVE",
          logoutTime: null,
        },
        orderBy: {
          loginTime: "desc",
        },
      });

      if (activeSession) {
        const duration = session_time
          ? Math.floor(session_time / 60)
          : Math.floor(
              (Date.now() - activeSession.loginTime.getTime()) / 60000
            );

        await prisma.routerSession.update({
          where: { id: activeSession.id },
          data: {
            status: "ENDED",
            logoutTime: new Date(),
            duration: duration,
            endedAt: new Date(),
          },
        });

        logger.info(`✅ Session ended for user: ${username} (${duration} min)`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("❌ Event handling error:", error);
    res.status(500).json({ success: false, error: "Event processing failed" });
  }
});

/**
 * GET /api/mikrotik/health
 * Health check endpoint for MikroTik to verify connectivity
 */
router.get("/health", validateMikroTikKey, async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    const activeSubCount = await prisma.subscription.count({
      where: {
        status: "ACTIVE",
        endTime: {
          gt: new Date(),
        },
      },
    });

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      total_users: userCount,
      active_subscriptions: activeSubCount,
    });
  } catch (error) {
    logger.error("❌ Health check error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Database connection failed" });
  }
});
/**
 * GET /api/mikrotik/expired
 * Get list of users to disable (expired subscriptions)
 */
router.get("/expired", validateMikroTikKey, async (req, res) => {
  try {
    // Get subscriptions that expired in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        OR: [
          { status: "EXPIRED" },
          {
            status: "ACTIVE",
            endTime: {
              lt: new Date(), // Already expired
              gt: oneHourAgo, // In the last hour
            },
          },
        ],
      },
      include: {
        user: {
          select: {
            username: true,
            phone: true,
          },
        },
      },
    });

    // Format: username|expiry_time|subscription_id
    const lines = expiredSubscriptions.map((sub) => {
      const username =
        sub.user.username || sub.user.phone || `user_${sub.userId}`;
      const expiryTime = sub.endTime.toISOString();
      return `${username}|${expiryTime}|${sub.id}`;
    });

    res.type("text/plain").send(lines.join("\n"));
  } catch (error) {
    logger.error("❌ Expired users sync error:", error);
    res.status(500).send("Error fetching expired users");
  }
});
/**
 * GET /api/mikrotik/stats
 * Get synchronization statistics
 */
router.get("/stats", validateMikroTikKey, async (req, res) => {
  try {
    const [totalUsers, activeSubscriptions, activeSessions, lastSyncLogs] =
      await Promise.all([
        prisma.user.count(),
        prisma.subscription.count({
          where: {
            status: "ACTIVE",
            endTime: { gt: new Date() },
          },
        }),
        prisma.routerSession.count({
          where: { status: "ACTIVE", endedAt: null },
        }),
        prisma.syncLog.findMany({
          take: 10,
          orderBy: { createdAt: "desc" },
        }),
      ]);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        totalUsers,
        activeSubscriptions,
        activeSessions,
      },
      recentSyncs: lastSyncLogs,
    });
  } catch (error) {
    logger.error("❌ Stats error:", error);
    res.status(500).json({ success: false, error: "Failed to get stats" });
  }
});
export default router;
