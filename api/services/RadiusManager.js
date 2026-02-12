// services/RadiusManager.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const RadiusManager = {
  /**
   * Create RADIUS user when subscription is activated
   */
  createRadiusUser: async ({ username, password, planProfile }) => {
    try {
      // 1. Create user credentials in radcheck
      await prisma.radCheck.create({
        data: {
          username: username,
          attribute: "Cleartext-Password",
          op: ":=",
          value: password,
        },
      });

      // 2. Set user profile/plan in radreply
      // This assigns speed limits, time limits, etc.
      await prisma.radReply.create({
        data: {
          username: username,
          attribute: "Mikrotik-Rate-Limit",
          op: "=",
          value: planProfile.rateLimit || "10M/10M", // e.g., "5M/5M" for 5Mbps
        },
      });

      // Optional: Session timeout
      if (planProfile.sessionTimeout) {
        await prisma.radReply.create({
          data: {
            username: username,
            attribute: "Session-Timeout",
            op: "=",
            value: planProfile.sessionTimeout.toString(),
          },
        });
      }

      console.log(`✅ RADIUS user created: ${username}`);
      return { success: true, username };
    } catch (error) {
      console.error("❌ RADIUS user creation error:", error);
      throw error;
    }
  },

  /**
   * Delete RADIUS user (on subscription expiry)
   */
  deleteRadiusUser: async (username) => {
    try {
      await prisma.radCheck.deleteMany({ where: { username } });
      await prisma.radReply.deleteMany({ where: { username } });

      console.log(`✅ RADIUS user deleted: ${username}`);
      return { success: true };
    } catch (error) {
      console.error("❌ RADIUS user deletion error:", error);
      throw error;
    }
  },

  /**
   * Update user profile (speed, time limits)
   */
  updateUserProfile: async ({ username, planProfile }) => {
    try {
      // Update rate limit
      await prisma.radReply.updateMany({
        where: {
          username,
          attribute: "Mikrotik-Rate-Limit",
        },
        data: {
          value: planProfile.rateLimit || "10M/10M",
        },
      });

      console.log(`✅ RADIUS profile updated: ${username}`);
      return { success: true };
    } catch (error) {
      console.error("❌ RADIUS profile update error:", error);
      throw error;
    }
  },

  /**
   * Get active sessions for a user
   */
  getActiveSessions: async (username) => {
    try {
      const sessions = await prisma.radAcct.findMany({
        where: {
          username,
          acctstoptime: null, // Still active
        },
        orderBy: {
          acctstarttime: "desc",
        },
      });

      return sessions;
    } catch (error) {
      console.error("❌ Error fetching sessions:", error);
      throw error;
    }
  },

  /**
   * Get user's data usage
   */
  getUserDataUsage: async (username, startDate = null) => {
    try {
      const whereClause = {
        username,
      };

      if (startDate) {
        whereClause.acctstarttime = {
          gte: startDate,
        };
      }

      const sessions = await prisma.radAcct.findMany({
        where: whereClause,
      });

      const totalInput = sessions.reduce(
        (sum, s) => sum + (s.acctinputoctets || BigInt(0)),
        BigInt(0),
      );
      const totalOutput = sessions.reduce(
        (sum, s) => sum + (s.acctoutputoctets || BigInt(0)),
        BigInt(0),
      );
      const totalBytes = totalInput + totalOutput;

      return {
        username,
        totalBytes: Number(totalBytes),
        totalMB: Number(totalBytes) / (1024 * 1024),
        totalGB: Number(totalBytes) / (1024 * 1024 * 1024),
        sessionCount: sessions.length,
      };
    } catch (error) {
      console.error("❌ Error calculating data usage:", error);
      throw error;
    }
  },

  /**
   * Disconnect active session (kick user)
   */
  disconnectUser: async (username) => {
    // This requires MikroTik API integration
    // For now, we can mark sessions as stopped
    try {
      await prisma.radAcct.updateMany({
        where: {
          username,
          acctstoptime: null,
        },
        data: {
          acctstoptime: new Date(),
          acctterminatecause: "Admin-Reset",
        },
      });

      console.log(`✅ User disconnected: ${username}`);
      return { success: true };
    } catch (error) {
      console.error("❌ Error disconnecting user:", error);
      throw error;
    }
  },

  /**
   * Get real-time MAC address from active sessions
   */
  getActiveMacAddress: async (username) => {
    try {
      const activeSession = await prisma.radAcct.findFirst({
        where: {
          username,
          acctstoptime: null,
        },
        orderBy: {
          acctstarttime: "desc",
        },
      });

      if (activeSession && activeSession.callingstationid) {
        // callingstationid contains the MAC address
        return {
          macAddress: activeSession.callingstationid,
          ipAddress: activeSession.framedipaddress,
          sessionStart: activeSession.acctstarttime,
        };
      }

      return null;
    } catch (error) {
      console.error("❌ Error fetching MAC address:", error);
      throw error;
    }
  },
};

export default RadiusManager;
