import prisma from "../config/db.js";
import { connectMikroTik } from "./mikrotik.js";
import { differenceInMinutes } from "date-fns";

// Helper to generate username from phone
const generateUsername = (phone) => {
  return `user_${phone.replace(/\D/g, "")}`;
};

// Helper to generate random password
const generatePassword = () => {
  return Math.random().toString(36).slice(-8);
};

export const RouterSessionManager = {
  /**
   * Automatically start session after subscription creation
   */
  startAutomatic: async ({ subscriptionId, macAddress, ipAddress }) => {
    let client;
    try {
      client = await connectMikroTik();
      // Get subscription with user and plan details
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          user: true,
          plan: true,
        },
      });

      if (!subscription) throw new Error("Subscription not found");

      // Check if subscription is active
      if (
        subscription.status !== "ACTIVE" ||
        new Date(subscription.endTime) < new Date()
      ) {
        throw new Error("Subscription is not active");
      }

      // Check if user already has an active session
      const existingSession = await prisma.routerSession.findFirst({
        where: {
          userId: subscription.userId,
          status: "ACTIVE",
          endedAt: null,
        },
      });

      if (existingSession) {
        // End the old session first
        await this.end({ userId: subscription.userId });
      }

      // Generate credentials if user doesn't have them
      let username = subscription.user.username;
      let password = subscription.user.password;

      if (!username || !password) {
        username = generateUsername(
          subscription.user.phone || `guest_${subscription.userId}`
        );
        password = generatePassword();

        await prisma.user.update({
          where: { id: subscription.userId },
          data: { username, password },
        });
      }

      // Update user's MAC address if provided
      if (macAddress && macAddress !== subscription.user.macAddress) {
        await prisma.user.update({
          where: { id: subscription.userId },
          data: { macAddress },
        });
      }

      // Connect to MikroTik with timeout
      console.log("🔌 Connecting to MikroTik...");
      try {
        client = await Promise.race([
          connectMikroTik(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("MikroTik connection timeout")),
              15000
            )
          ),
        ]);
        console.log("✅ MikroTik connected");
      } catch (connError) {
        console.error("❌ MikroTik connection failed:", connError.message);
        throw new Error(`Cannot connect to MikroTik: ${connError.message}`);
      }

      // Profile name from plan (remove spaces and special characters)
      let profileName = subscription.plan.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");

      // Check and create profile if needed
      try {
        console.log(`🔍 Checking if profile "${profileName}" exists...`);
        const profiles = await client.menu("/ip/hotspot/user/profile").getAll();
        const profileExists = profiles.some((p) => p.name === profileName);

        if (!profileExists) {
          console.log(`🆕 Creating profile: ${profileName}`);

          // Calculate session timeout based on plan
          let sessionTimeout;
          switch (subscription.plan.durationType) {
            case "MINUTE":
              sessionTimeout = `${subscription.plan.durationValue}m`;
              break;
            case "HOUR":
              sessionTimeout = `${subscription.plan.durationValue}h`;
              break;
            case "DAY":
              sessionTimeout = `${subscription.plan.durationValue}d`;
              break;
            case "WEEK":
              sessionTimeout = `${subscription.plan.durationValue}w`;
              break;
            case "MONTH":
              // MikroTik doesn't have month, convert to days (30 days per month)
              sessionTimeout = `${subscription.plan.durationValue * 30}d`;
              break;
            default:
              sessionTimeout = "1h";
          }

          await client.menu("/ip/hotspot/user/profile").add({
            name: profileName,
            "rate-limit": "10M/10M", // 10 Mbps up/down - adjust as needed
            "session-timeout": sessionTimeout,
            "shared-users": "1",
            "keepalive-timeout": "2m",
          });

          console.log(
            `✅ Profile "${profileName}" created with timeout: ${sessionTimeout}`
          );
        } else {
          console.log(`✅ Profile "${profileName}" already exists`);
        }
      } catch (profileError) {
        console.error("❌ Profile check/creation error:", profileError.message);
        console.log("⚠️  Falling back to 'default' profile");
        profileName = "default";
      }

      // Add user to hotspot
      console.log(`👤 Adding user "${username}" to hotspot...`);
      await client.menu("/ip/hotspot/user").add({
        name: username,
        password: password,
        profile: profileName,
        "mac-address": macAddress,
        comment: `Sub_${subscriptionId}`,
      });

      // Create session in database
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          startedAt: new Date(),
        },
      });

      console.log(
        `✅ Session started for user ${username} (Profile: ${profileName})`
      );
      return session;
    } catch (error) {
      // Check if user already exists
      if (error.message && error.message.includes("already exists")) {
        console.log("⚠️  User already exists, updating...");
        return await this.updateExistingUser({
          subscriptionId,
          macAddress,
          ipAddress,
        });
      }
      console.error("❌ Session start error:", error.message);
      throw error;
    } finally {
      if (client) {
        try {
          await client.close();
          console.log("🔌 MikroTik connection closed");
        } catch (e) {
          console.warn("⚠️ Failed to close MikroTik connection:", e.message);
        }
      }
    }
  },
  /**
   * Update existing MikroTik user
   */
  updateExistingUser: async ({ subscriptionId, macAddress, ipAddress }) => {
    let client;
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          user: true,
          plan: true,
        },
      });

      if (!subscription) throw new Error("Subscription not found");

      const username =
        subscription.user.username ||
        generateUsername(
          subscription.user.phone || `guest_${subscription.userId}`
        );
      const password = subscription.user.password || generatePassword();
      const profileName = subscription.plan.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");

      // Connect to MikroTik
      client = await connectMikroTik();

      // Get existing user
      const existingUsers = await client.menu("/ip/hotspot/user").getAll();
      const userEntry = existingUsers.find((u) => u.name === username);

      if (userEntry) {
        // Update existing user
        await client.menu("/ip/hotspot/user").update({
          id: userEntry[".id"],
          password: password,
          profile: profileName,
          "mac-address": macAddress,
          comment: `Sub_${subscriptionId}`,
        });
      } else {
        // Add new user if not found
        await client.menu("/ip/hotspot/user").add({
          name: username,
          password: password,
          profile: profileName,
          "mac-address": macAddress,
          comment: `Sub_${subscriptionId}`,
        });
      }

      // Create session in database
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          startedAt: new Date(),
        },
      });

      console.log(`✅ User ${username} updated and session created`);
      return session;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Manual session start (for existing subscriptions)
   */
  start: async ({ userId, macAddress, ipAddress }) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) throw new Error("User not found");

      // Find active subscription
      const activeSub = await prisma.subscription.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          endTime: { gt: new Date() },
        },
        include: {
          plan: true,
        },
      });

      if (!activeSub) throw new Error("No active subscription found");

      // Use the automatic starter
      return await this.startAutomatic({
        subscriptionId: activeSub.id,
        macAddress,
        ipAddress,
      });
    } catch (error) {
      throw error;
    }
  },

  /**
   * End session and remove from MikroTik
   */
  end: async ({ userId, macAddress }) => {
    let client;
    try {
      const whereClause = {};
      if (userId) whereClause.userId = userId;
      if (macAddress) whereClause.macAddress = macAddress;
      whereClause.endedAt = null;

      const session = await prisma.routerSession.findFirst({
        where: whereClause,
        include: { user: true },
      });

      if (!session) throw new Error("Session not found");

      // Connect to MikroTik
      client = await connectMikroTik();

      // Get all hotspot users
      const users = await client.menu("/ip/hotspot/user").getAll();
      const userEntry = users.find((u) => u.name === session.user.username);

      if (userEntry) {
        // Remove user from hotspot
        await client.menu("/ip/hotspot/user").remove(userEntry[".id"]);
        console.log(`🗑️  Removed user ${session.user.username} from MikroTik`);
      }

      // Update session in database
      const endedAt = new Date();
      const updated = await prisma.routerSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          status: "INACTIVE",
        },
      });

      console.log(`✅ Session ended for user ${session.user.username}`);
      return updated;
    } catch (error) {
      // Even if MikroTik removal fails, mark session as inactive
      if (error.message === "Session not found") {
        throw error;
      }

      console.error(
        "Error ending session, marking as inactive anyway:",
        error.message
      );

      const whereClause = {};
      if (userId) whereClause.userId = userId;
      if (macAddress) whereClause.macAddress = macAddress;
      whereClause.endedAt = null;

      const session = await prisma.routerSession.findFirst({
        where: whereClause,
      });

      if (session) {
        const endedAt = new Date();
        return await prisma.routerSession.update({
          where: { id: session.id },
          data: {
            endedAt,
            status: "INACTIVE",
          },
        });
      }

      throw error;
    }
  },

  /**
   * End all sessions for a user
   */
  endAllUserSessions: async (userId) => {
    try {
      const sessions = await prisma.routerSession.findMany({
        where: {
          userId,
          endedAt: null,
        },
      });

      const results = [];
      for (const session of sessions) {
        try {
          const result = await this.end({ userId: session.userId });
          results.push(result);
        } catch (err) {
          console.error(`Failed to end session ${session.id}:`, err.message);
        }
      }

      return results;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Check and cleanup expired sessions
   */
  cleanupExpiredSessions: async () => {
    try {
      // Find all active sessions with expired subscriptions
      const expiredSessions = await prisma.routerSession.findMany({
        where: {
          status: "ACTIVE",
          endedAt: null,
          subscription: {
            OR: [{ status: "EXPIRED" }, { endTime: { lt: new Date() } }],
          },
        },
      });

      const results = [];
      for (const session of expiredSessions) {
        try {
          const result = await this.end({ userId: session.userId });
          results.push(result);
        } catch (err) {
          console.error(
            `Failed to cleanup session ${session.id}:`,
            err.message
          );
        }
      }

      console.log(`✅ Cleaned up ${results.length} expired sessions`);
      return results;
    } catch (error) {
      throw error;
    }
  },
};
