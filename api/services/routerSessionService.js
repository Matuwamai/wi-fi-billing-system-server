// Based on your screenshot, these columns appear empty in RouterSession:
// - ipAddress
// - loginTime
// - logoutTime
// - duration
// - macAddress (in session table, not user table)

// Here's the updated RouterSessionManager with proper data population:

import prisma from "../config/db.js";
import { connectMikroTik } from "./mikrotik.js";
import { differenceInMinutes } from "date-fns";

const generateUsername = (phone) => {
  return `user_${phone.replace(/\D/g, "")}`;
};

const generatePassword = () => {
  return Math.random().toString(36).slice(-8);
};

const getItemId = (item) => {
  return item[".id"] || item.id || item[".id*"] || null;
};

const closeMikrotik = (client) => {
  if (!client) return;
  try {
    if (typeof client.close === "function") {
      client.close();
    } else if (typeof client.disconnect === "function") {
      client.disconnect();
    }
    console.log("🔌 MikroTik connection closed");
  } catch (e) {
    console.warn("⚠️ Failed to close MikroTik connection:", e.message);
  }
};

export const RouterSessionManager = {
  /**
   * Automatically start session after subscription creation
   */
  startAutomatic: async ({ subscriptionId, macAddress, ipAddress }) => {
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

      if (
        subscription.status !== "ACTIVE" ||
        new Date(subscription.endTime) < new Date()
      ) {
        throw new Error("Subscription is not active");
      }

      const existingSession = await prisma.routerSession.findFirst({
        where: {
          userId: subscription.userId,
          status: "ACTIVE",
          endedAt: null,
        },
      });

      if (existingSession) {
        await RouterSessionManager.end({ userId: subscription.userId });
      }

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

      if (macAddress && macAddress !== subscription.user.macAddress) {
        await prisma.user.update({
          where: { id: subscription.userId },
          data: { macAddress },
        });
      }

      console.log("🔌 Connecting to MikroTik...");
      try {
        client = await connectMikroTik();
        console.log("✅ MikroTik connected");
      } catch (connError) {
        console.error("❌ MikroTik connection failed:", connError.message);
        throw new Error(`Cannot connect to MikroTik: ${connError.message}`);
      }

      let profileName = subscription.plan.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");

      try {
        console.log(`🔍 Checking if profile "${profileName}" exists...`);
        const profiles = await client.menu("/ip/hotspot/user/profile").getAll();
        const profileExists = profiles.some((p) => p.name === profileName);

        if (!profileExists) {
          console.log(`🆕 Creating profile: ${profileName}`);

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
              sessionTimeout = `${subscription.plan.durationValue * 30}d`;
              break;
            default:
              sessionTimeout = "1h";
          }

          await client.menu("/ip/hotspot/user/profile").add({
            name: profileName,
            "rate-limit": "10M/10M",
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

      console.log(`👤 Syncing hotspot user "${username}"...`);

      try {
        const hotspotMenu = client.menu("/ip/hotspot/user");

        console.log("🔍 Checking for existing user...");
        const allUsers = await hotspotMenu.getAll();
        console.log(`📋 Found ${allUsers.length} total hotspot users`);

        const existingUser = allUsers.find((u) => u.name === username);

        if (existingUser) {
          const userId = getItemId(existingUser);
          console.log(`♻️ Found existing user "${username}" (ID: ${userId})`);

          if (userId) {
            try {
              console.log(`🗑️ Removing existing user...`);
              await hotspotMenu.remove(userId);
              console.log("✅ Old user removed successfully");

              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (removeErr) {
              console.warn(`⚠️ Remove failed: ${removeErr.message}`);
            }
          }
        } else {
          console.log("ℹ️ No existing user found with this username");
        }

        console.log("➕ Adding hotspot user...");
        await hotspotMenu.add({
          name: username,
          password: password,
          profile: profileName,
          ...(macAddress && { "mac-address": macAddress }),
          comment: `Sub_${subscriptionId}`,
        });

        console.log("✅ Hotspot user added successfully");
      } catch (userError) {
        console.error("❌ Hotspot user operation failed:", userError.message);

        if (
          userError.message &&
          userError.message.includes("already have user")
        ) {
          console.log("🔄 Attempting alternative cleanup method...");

          try {
            const hotspotMenu = client.menu("/ip/hotspot/user");
            const usersByName = await hotspotMenu
              .where("name", username)
              .getAll();

            console.log(
              `📋 Found ${usersByName.length} users matching name "${username}"`
            );

            for (const user of usersByName) {
              const userId = getItemId(user);
              if (userId) {
                try {
                  await hotspotMenu.remove(userId);
                  console.log(`🗑️ Removed user ID: ${userId}`);
                } catch (e) {
                  console.warn(
                    `⚠️ Failed to remove ID ${userId}: ${e.message}`
                  );
                }
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));

            await hotspotMenu.add({
              name: username,
              password: password,
              profile: profileName,
              ...(macAddress && { "mac-address": macAddress }),
              comment: `Sub_${subscriptionId}`,
            });

            console.log("✅ User added after alternative cleanup");
          } catch (altError) {
            console.error("❌ Alternative method failed:", altError.message);
            throw new Error(
              `Cannot sync hotspot user after multiple attempts: ${altError.message}`
            );
          }
        } else {
          throw new Error(`Failed to sync hotspot user: ${userError.message}`);
        }
      }

      // ✅ Create session with ALL required fields
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          ipAddress: ipAddress || null,
          macAddress: macAddress || null,
          // loginTime, startedAt use @default(now()) from schema
          // logoutTime, duration, endedAt set when session ends
        },
      });

      console.log(
        `✅ Session started for user ${username} (Profile: ${profileName})`
      );
      return session;
    } catch (error) {
      console.error("❌ Session start error:", error.message);
      throw error;
    } finally {
      closeMikrotik(client);
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

      client = await connectMikroTik();
      const hotspotMenu = client.menu("/ip/hotspot/user");

      const existingUsers = await hotspotMenu.getAll();
      const userEntry = existingUsers.find((u) => u.name === username);

      if (userEntry) {
        const userId = getItemId(userEntry);
        if (userId) {
          try {
            await hotspotMenu.remove(userId);
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (e) {
            console.warn("⚠️ Remove failed:", e.message);
          }
        }
      }

      await hotspotMenu.add({
        name: username,
        password: password,
        profile: profileName,
        ...(macAddress && { "mac-address": macAddress }),
        comment: `Sub_${subscriptionId}`,
      });

      // ✅ Create session with ALL required fields
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          ipAddress: ipAddress || null,
          macAddress: macAddress || null,
          // loginTime, startedAt use @default(now()) from schema
        },
      });

      console.log(`✅ User ${username} updated and session created`);
      return session;
    } catch (error) {
      throw error;
    } finally {
      closeMikrotik(client);
    }
  },

  /**
   * Manual session start (for existing subscriptions)
   */
  start: async ({ userId, macAddress, ipAddress }) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("User not found");

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

      return await RouterSessionManager.startAutomatic({
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
      const whereClause = { endedAt: null };
      if (userId) whereClause.userId = userId;
      if (macAddress) whereClause.macAddress = macAddress;

      const session = await prisma.routerSession.findFirst({
        where: whereClause,
        include: { user: true },
      });

      if (!session) throw new Error("Session not found");

      client = await connectMikroTik();
      const hotspotMenu = client.menu("/ip/hotspot/user");
      const users = await hotspotMenu.getAll();
      const userEntry = users.find((u) => u.name === session.user.username);

      if (userEntry) {
        const userId = getItemId(userEntry);
        if (userId) {
          try {
            await hotspotMenu.remove(userId);
            console.log(
              `🗑️ Removed user ${session.user.username} from MikroTik`
            );
          } catch (removeErr) {
            console.warn(`⚠️ Failed to remove user: ${removeErr.message}`);
          }
        }
      }

      // ✅ FIXED: Calculate duration and set all end fields
      const endedAt = new Date();
      const durationMinutes = session.startedAt
        ? differenceInMinutes(endedAt, session.startedAt)
        : 0;

      const updated = await prisma.routerSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          logoutTime: endedAt, // ✅ Added
          status: "INACTIVE",
          duration: durationMinutes, // ✅ Added (in minutes)
        },
      });

      console.log(
        `✅ Session ended for user ${session.user.username} (Duration: ${durationMinutes} minutes)`
      );
      return updated;
    } catch (error) {
      if (error.message === "Session not found") throw error;

      console.error(
        "Error ending session, marking as inactive anyway:",
        error.message
      );

      const whereClause = { endedAt: null };
      if (userId) whereClause.userId = userId;
      if (macAddress) whereClause.macAddress = macAddress;

      const session = await prisma.routerSession.findFirst({
        where: whereClause,
      });

      if (session) {
        const endedAt = new Date();
        const durationMinutes = session.startedAt
          ? differenceInMinutes(endedAt, session.startedAt)
          : 0;

        return await prisma.routerSession.update({
          where: { id: session.id },
          data: {
            endedAt,
            logoutTime: endedAt,
            status: "INACTIVE",
            duration: durationMinutes,
          },
        });
      }

      throw error;
    } finally {
      closeMikrotik(client);
    }
  },

  /**
   * End all sessions for a user
   */
  endAllUserSessions: async (userId) => {
    try {
      const sessions = await prisma.routerSession.findMany({
        where: { userId, endedAt: null },
      });

      const results = [];
      for (const session of sessions) {
        try {
          const result = await RouterSessionManager.end({
            userId: session.userId,
          });
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
          const result = await RouterSessionManager.end({
            userId: session.userId,
          });
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
