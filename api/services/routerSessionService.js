import prisma from "../config/db.js";
import { differenceInMinutes } from "date-fns";

/*
 * 2. Session record created in DB (optional, for tracking)
 * 3. MikroTik sync script runs (every 5 min)
 * 4. MikroTik creates hotspot user from active subscriptions
 * 5. User logs in to hotspot
 * 6. MikroTik sends event to /api/mikrotik/event (optional)
 */

const generateUsername = (phone) => {
  return `user_${phone.replace(/\D/g, "")}`;
};

const generatePassword = () => {
  return Math.random().toString(36).slice(-8);
};

export const RouterSessionManager = {
  /**
   * ✅ SIMPLIFIED: Just create DB records, no MikroTik connection
   * MikroTik will sync users automatically
   */
  startAutomatic: async ({ subscriptionId, macAddress, ipAddress }) => {
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

      // Close any existing active sessions for this user
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

      // Generate username/password if not exists
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

      // Update MAC address if provided
      if (macAddress && macAddress !== subscription.user.macAddress) {
        await prisma.user.update({
          where: { id: subscription.userId },
          data: { macAddress },
        });
      }

      // Create session record (for tracking purposes)
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          ipAddress: ipAddress || null,
          macAddress: macAddress || null,
        },
      });

      console.log(
        `✅ Session record created for user ${username} (Sub: ${subscriptionId})`
      );
      console.log(
        `⏰ MikroTik will sync this user within 5 minutes automatically`
      );

      return session;
    } catch (error) {
      console.error("❌ Session creation error:", error.message);
      throw error;
    }
  },

  /**
   * ✅ SIMPLIFIED: Update user credentials and create session
   */
  updateExistingUser: async ({ subscriptionId, macAddress, ipAddress }) => {
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

      // Update user credentials if needed
      if (!subscription.user.username || !subscription.user.password) {
        await prisma.user.update({
          where: { id: subscription.userId },
          data: { username, password },
        });
      }

      // Create session record
      const session = await prisma.routerSession.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          status: "ACTIVE",
          ipAddress: ipAddress || null,
          macAddress: macAddress || null,
        },
      });

      console.log(`✅ User ${username} updated and session created`);
      console.log(`⏰ MikroTik will sync within 5 minutes`);

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
   * ✅ SIMPLIFIED: End session in DB only
   * Note: MikroTik will automatically disable the user on next sync
   * when subscription becomes inactive
   */
  end: async ({ userId, macAddress }) => {
    try {
      const whereClause = { endedAt: null };
      if (userId) whereClause.userId = userId;
      if (macAddress) whereClause.macAddress = macAddress;

      const session = await prisma.routerSession.findFirst({
        where: whereClause,
        include: { user: true },
      });

      if (!session) throw new Error("Session not found");

      // Calculate duration and end session
      const endedAt = new Date();
      const durationMinutes = session.startedAt
        ? differenceInMinutes(endedAt, session.startedAt)
        : 0;

      const updated = await prisma.routerSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          logoutTime: endedAt,
          status: "INACTIVE",
          duration: durationMinutes,
        },
      });

      console.log(
        `✅ Session ended for user ${session.user.username} (Duration: ${durationMinutes} minutes)`
      );
      console.log(
        `⏰ MikroTik will disable this user on next sync if subscription is inactive`
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
        include: {
          user: true,
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

  /**
   * ✅ NEW: Get session statistics
   */
  getStats: async () => {
    try {
      const [activeSessions, totalSessions, activeSubscriptions] =
        await Promise.all([
          prisma.routerSession.count({
            where: { status: "ACTIVE", endedAt: null },
          }),
          prisma.routerSession.count(),
          prisma.subscription.count({
            where: {
              status: "ACTIVE",
              endTime: { gt: new Date() },
            },
          }),
        ]);

      return {
        activeSessions,
        totalSessions,
        activeSubscriptions,
      };
    } catch (error) {
      throw error;
    }
  },
};
