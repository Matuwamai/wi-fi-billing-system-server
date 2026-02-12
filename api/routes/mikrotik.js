import prisma from "../config/db.js";
import logger from "../utils/logger.js";
import express from "express";
import { RouterSessionManager } from "../services/routerSessionService.js";

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
router.get("/update-device-hostname", async (req, res) => {
  try {
    // Get parameters from query string instead of body
    const {
      macAddress,
      deviceHostname,
      ipAddress,
      authorized,
      tempToken, // From URL parameters
      phone, // Optional phone for matching
    } = req.query;

    console.log("📡 Device detection (GET):", {
      macAddress,
      deviceHostname,
      tempToken,
      phone,
      ipAddress,
      authorized,
    });

    if (!macAddress) {
      return res.status(400).json({
        success: false,
        message: "MAC address required",
      });
    }

    // Clean device hostname
    const cleanHostname =
      deviceHostname && deviceHostname !== "undefined"
        ? deviceHostname
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, "")
            .substring(0, 30)
        : null;

    let user = null;
    let matchType = "unknown";

    // ====== METHOD 1: TEMP TOKEN MATCHING (Most Reliable) ======
    if (tempToken && tempToken !== "undefined") {
      user = await prisma.user.findFirst({
        where: {
          tempAccessToken: tempToken,
          tempTokenExpiry: { gt: new Date() }, // Not expired
        },
      });
      if (user) {
        matchType = "temp_token_match";
        console.log(`✅ Temp token match: ${tempToken} → User ${user.id}`);
      }
    }

    // ====== METHOD 2: RECENT TEMP USER MATCHING ======
    if (!user) {
      // Look for users created in last 30 minutes with temp MACs
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      const whereConditions = [];

      // User with same phone created recently
      if (phone && phone !== "undefined") {
        whereConditions.push({
          phone: phone,
          createdAt: { gte: thirtyMinutesAgo },
        });
      }

      // User with similar device name created recently
      if (cleanHostname) {
        whereConditions.push({
          username: { contains: cleanHostname.substring(0, 10) },
          createdAt: { gte: thirtyMinutesAgo },
          isTempMac: true,
        });
      }

      if (whereConditions.length > 0) {
        user = await prisma.user.findFirst({
          where: { OR: whereConditions },
          orderBy: { createdAt: "desc" },
        });
        if (user) matchType = "recent_user_match";
      }
    }

    // ====== METHOD 3: EXACT USERNAME MATCH ======
    if (!user && cleanHostname) {
      user = await prisma.user.findFirst({
        where: { username: cleanHostname },
      });
      if (user) matchType = "username_exact_match";
    }

    // ====== METHOD 4: PARTIAL USERNAME MATCH ======
    if (!user && cleanHostname && cleanHostname.length > 5) {
      // Try partial matches (e.g., "matu-s-a05" matches "matu-s")
      const partialMatches = await prisma.user.findMany({
        where: {
          OR: [
            { username: { startsWith: cleanHostname.substring(0, 5) } },
            { username: { contains: cleanHostname.substring(0, 5) } },
          ],
          isTempMac: true,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (partialMatches.length > 0) {
        user = partialMatches[0];
        matchType = "username_partial_match";
      }
    }

    // ====== METHOD 5: CREATE NEW GUEST USER ======
    if (!user) {
      const password = Math.random().toString(36).substring(2, 10);
      const username =
        cleanHostname || `guest_${Math.random().toString(36).substring(2, 8)}`;

      user = await prisma.user.create({
        data: {
          username: username,
          password: password,
          deviceName: deviceHostname || "Unknown Device",
          macAddress: macAddress,
          isTempMac: false, // This is a real MAC
          status: "ACTIVE",
          role: "USER",
          isGuest: true,
        },
      });
      matchType = "new_guest_user";
      console.log(`🆕 Created guest user: ${username} for MAC: ${macAddress}`);
    }

    // ====== UPDATE USER WITH REAL MAC ======
    const updateData = {
      macAddress: macAddress,
      isTempMac: false,
      deviceName: deviceHostname || user.deviceName,
      lastMacUpdate: new Date(),
      updatedAt: new Date(),
    };

    // Update username to device hostname if different
    if (
      cleanHostname &&
      user.username !== cleanHostname &&
      !user.username.startsWith("guest_")
    ) {
      updateData.username = cleanHostname;
    }

    // Clear temp token if used
    if (matchType === "temp_token_match") {
      updateData.tempAccessToken = null;
      updateData.tempTokenExpiry = null;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    console.log(
      `✅ User updated: ${updatedUser.username}, MAC: ${updatedUser.macAddress}, Match: ${matchType}`
    );

    // ====== AUTO-AUTHORIZE IF HAS ACTIVE SUBSCRIPTION ======
    let autoAuthorized = false;
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        endTime: { gt: new Date() },
      },
    });

    if (activeSubscription) {
      await prisma.routerSession.create({
        data: {
          userId: user.id,
          planId: activeSubscription.planId,
          subscriptionId: activeSubscription.id,
          macAddress: macAddress,
          ipAddress: ipAddress,
          status: "ACTIVE",
          loginTime: new Date(),
        },
      });
      autoAuthorized = true;
      console.log(`✅ Auto-authorized user with active subscription`);
    }

    res.json({
      success: true,
      message: "Device registered successfully",
      matchType: matchType,
      autoAuthorized: autoAuthorized,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        hasActiveSubscription: !!activeSubscription,
        needsPayment: !activeSubscription,
      },
    });
  } catch (error) {
    console.error("❌ Device update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update device",
      error: error.message,
    });
  }
});
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
    const syncInfo = [
      `# Sync: ${new Date().toISOString()}`,
      `# Count: ${lines.length}`,
      `# Router: ${routerId || "unknown"}`,
      "", // Empty line to separate header from data
    ].join("\n");

    res
      .type("text/plain")
      .set("X-Sync-Timestamp", new Date().toISOString())
      .set("X-Total-Users", lines.length.toString())
      .send(syncInfo + "\n" + lines.join("\n"));
  } catch (error) {
    logger.error("❌ Simple sync error:", error);
    res.status(500).send("# ERROR: Sync failed\n");
  }
});

//  * NEW ENDPOINT: Get MAC address bypass list
//  * MikroTik will add these MACs to bypass list for automatic login
//  */
// UPDATED: MAC Bypass endpoint - Skip TEMP MACs
router.get("/mac-bypass", validateMikroTikKey, async (req, res) => {
  try {
    logger.info("MikroTik requesting MAC bypass list");

    // Get users with active subscriptions and REAL MACs only
    const usersWithActiveSubs = await prisma.user.findMany({
      where: {
        macAddress: {
          not: null,
        },
        // IMPORTANT: Only users with REAL MACs (not temp)
        isTempMac: false,
        subscriptions: {
          some: {
            status: "ACTIVE",
            endTime: {
              gt: new Date(),
            },
          },
        },
      },
      select: {
        id: true,
        username: true,
        macAddress: true,
        phone: true,
        isTempMac: true,
        lastMacUpdate: true,
        subscriptions: {
          where: {
            status: "ACTIVE",
            endTime: {
              gt: new Date(),
            },
          },
          select: {
            plan: {
              select: {
                name: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    logger.info(
      `📡 Found ${usersWithActiveSubs.length} users with REAL MACs for bypass`
    );

    // Count temp users (for logging)
    const tempMacCount = await prisma.user.count({
      where: {
        isTempMac: true,
        macAddress: { not: null },
        subscriptions: {
          some: {
            status: "ACTIVE",
            endTime: { gt: new Date() },
          },
        },
      },
    });

    const macList = usersWithActiveSubs.map((user) => ({
      mac: user.macAddress,
      username: user.username || user.phone || `user_${user.id}`,
      comment: `Auto-login: ${user.subscriptions[0]?.plan.name || "Active"}`,
      isTemp: user.isTempMac,
    }));

    logger.info(
      `📡 MAC bypass list: ${macList.length} real devices (${tempMacCount} temp MACs skipped)`
    );

    // Log each MAC being sent
    macList.forEach((item, index) => {
      logger.info(`[${index + 1}] REAL: ${item.mac} | ${item.username}`);
    });

    // Return format: MAC|username|comment
    const lines = macList.map(
      (item) => `${item.mac}|${item.username}|${item.comment}`
    );

    res.type("text/plain").send(lines.join("\n"));
  } catch (error) {
    logger.error("❌ MAC bypass error:", error);
    res.status(500).send("Error");
  }
});

// This accepts MAC detection via GET instead of POST (workaround for MikroTik POST issues)

router.get("/detect-mac-get", validateMikroTikKey, async (req, res) => {
  try {
    // Get data from query parameters instead of body
    const { username, detectedMac, ipAddress, routerId } = req.query;

    if (!username || !detectedMac) {
      return res.status(400).json({ error: "Missing username or detectedMac" });
    }

    console.log(
      `🔍 MAC detection (GET): ${username} -> ${detectedMac} @ ${
        ipAddress || "N/A"
      }`
    );

    // IMPORTANT: Ignore TEMP MACs from detection
    if (detectedMac.toUpperCase().startsWith("02:00:00")) {
      console.log(`⏭️ Ignoring TEMP MAC: ${detectedMac}`);
      return res.json({
        success: true,
        message: "TEMP MAC ignored",
        action: "none",
      });
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { phone: username }],
      },
    });

    if (!user) {
      console.log(`❌ User not found: ${username}`);
      return res.status(404).json({ error: "User not found" });
    }

    const oldMac = user.macAddress;
    const wasTemp = user.isTempMac;

    // Update with REAL MAC
    await prisma.user.update({
      where: { id: user.id },
      data: {
        macAddress: detectedMac,
        isTempMac: false,
        lastMacUpdate: new Date(),
      },
    });

    console.log(
      `✅ Updated ${username}: ${wasTemp ? "TEMP->REAL" : "Updated"} MAC: ${
        oldMac || "none"
      } -> ${detectedMac}`
    );

    // Find active subscription
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        endTime: { gt: new Date() },
      },
    });

    if (activeSub) {
      try {
        // Find existing ACTIVE session
        const existingSession = await prisma.routerSession.findFirst({
          where: {
            subscriptionId: activeSub.id,
            status: "ACTIVE",
          },
        });

        if (existingSession) {
          // Update existing ACTIVE session
          await prisma.routerSession.update({
            where: { id: existingSession.id },
            data: {
              macAddress: detectedMac,
              ipAddress: ipAddress || existingSession.ipAddress,
              lastActivity: new Date(),
            },
          });
          console.log(`✅ Updated existing session with MAC: ${detectedMac}`);
        } else {
          // Create new ACTIVE session
          await prisma.routerSession.create({
            data: {
              userId: user.id,
              planId: activeSub.planId,
              subscriptionId: activeSub.id,
              macAddress: detectedMac,
              ipAddress: ipAddress,
              status: "ACTIVE",
              loginTime: new Date(),
              lastActivity: new Date(),
            },
          });
          console.log(`✅ Created new ACTIVE session for MAC: ${detectedMac}`);
        }

        // OPTIONAL: Also update any PENDING sessions if they exist
        await prisma.routerSession.updateMany({
          where: {
            userId: user.id,
            subscriptionId: activeSub.id,
            status: "PENDING",
            macAddress: null, // Only update if MAC wasn't set
          },
          data: {
            macAddress: detectedMac,
            ipAddress: ipAddress,
          },
        });
      } catch (sessionError) {
        console.error("⚠️ Router session update error:", sessionError);
      }
    }
    res.json({
      success: true,
      message: "MAC address detected and updated",
      wasTemp: wasTemp,
      oldMac: oldMac,
      newMac: detectedMac,
      username: username,
    });
  } catch (error) {
    console.error("❌ MAC detection error:", error);
    res.status(500).json({ error: "Failed to update MAC" });
  }
});

// Route for the one-click connection
router.get("/auto-connect", async (req, res) => {
  const { token } = req.query;

  // Find user by token
  const user = await prisma.user.findFirst({
    where: { tempAccessToken: token },
  });

  if (!user) {
    return res.send(`
      <html>
        <body>
          <h1>Token expired or invalid</h1>
          <p>Please make a payment first.</p>
        </body>
      </html>
    `);
  }

  // Generate WiFi config file for download
  const wifiConfig = `
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>Your WiFi Network</name>
  <SSIDConfig>
    <SSID>
      <name>Your-WiFi-Name</name>
    </SSID>
  </SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM>
    <security>
      <authEncryption>
        <authentication>WPA2PSK</authentication>
        <encryption>AES</encryption>
        <useOneX>false</useOneX>
      </authEncryption>
      <sharedKey>
        <keyType>passPhrase</keyType>
        <protected>false</protected>
        <keyMaterial>welcome123</keyMaterial>
      </sharedKey>
    </security>
  </MSM>
</WLANProfile>
  `;

  // Set headers for file download
  res.setHeader("Content-Type", "application/xml");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="wifi-config.xml"'
  );
  res.send(wifiConfig);
});
// HELPER: Generate temporary MAC address
// This should match the format you use in VoucherManager
function generateTempMac() {
  // Use 02:00:00 prefix (locally administered MAC)
  // This ensures MikroTik recognizes it as temp and won't use for bypass
  const randomBytes = Array.from({ length: 3 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()
  ).join(":");

  return `02:00:00:${randomBytes}`;
}
export { generateTempMac };
export default router;
