import prisma from "../config/db.js";
import { getMikroTikConnection } from "./mikrotik.js";
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
    try {
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
        new Date(subscription.endDate) < new Date()
      ) {
        throw new Error("Subscription is not active");
      }

      // Check if user already has an active session
      const existingSession = await prisma.routerSession.findFirst({
        where: {
          userId: subscription.userId,
          status: "ACTIVE",
          logoutTime: null,
        },
      });

      if (existingSession) {
        // End the old session first
        await this.end({ macAddress: existingSession.macAddress });
      }

      // Generate credentials if user doesn't have them
      let username = subscription.user.username;
      let password = subscription.user.password;

      if (!username || !password) {
        username = generateUsername(subscription.user.phone);
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

      const connection = getMikroTikConnection();

      return new Promise((resolve, reject) => {
        connection.connect(async (conn) => {
          try {
            const chan = conn.openChannel("add-user");

            // Profile name from plan (remove spaces)
            const profileName = subscription.plan.name.replace(/\s+/g, "_");

            chan.write(`/ip/hotspot/user/add`, [
              `=name=${username}`,
              `=password=${password}`,
              `=profile=${profileName}`,
              `=mac-address=${macAddress}`,
              `=comment=Sub_${subscriptionId}`,
            ]);

            chan.on("done", async () => {
              // Create session in database
              const session = await prisma.routerSession.create({
                data: {
                  userId: subscription.userId,
                  subscriptionId: subscription.id,
                  macAddress,
                  ipAddress,
                  status: "ACTIVE",
                  loginTime: new Date(),
                },
              });

              chan.close();
              conn.close();

              resolve(session);
            });

            chan.on("trap", async (data) => {
              chan.close();
              conn.close();

              // If user already exists, try to update instead
              if (data.toString().includes("already exists")) {
                try {
                  const updateResult = await this.updateExistingUser({
                    username,
                    password,
                    profileName,
                    macAddress,
                    subscriptionId,
                  });
                  resolve(updateResult);
                } catch (err) {
                  reject(new Error(`MikroTik Error: ${data}`));
                }
              } else {
                reject(new Error(`MikroTik Error: ${data}`));
              }
            });

            chan.on("error", (err) => {
              chan.close();
              conn.close();
              reject(err);
            });
          } catch (err) {
            conn.close();
            reject(err);
          }
        });
      });
    } catch (error) {
      throw error;
    }
  },

  /**
   * Update existing MikroTik user
   */
  updateExistingUser: async ({
    username,
    password,
    profileName,
    macAddress,
    subscriptionId,
  }) => {
    const connection = getMikroTikConnection();

    return new Promise((resolve, reject) => {
      connection.connect(async (conn) => {
        try {
          const chan = conn.openChannel("update-user");

          chan.write(`/ip/hotspot/user/set`, [
            `=numbers=${username}`,
            `=password=${password}`,
            `=profile=${profileName}`,
            `=mac-address=${macAddress}`,
            `=comment=Sub_${subscriptionId}`,
          ]);

          chan.on("done", async () => {
            // Get user and create session
            const user = await prisma.user.findFirst({
              where: { username },
            });

            const session = await prisma.routerSession.create({
              data: {
                userId: user.id,
                subscriptionId,
                macAddress,
                ipAddress: null,
                status: "ACTIVE",
                loginTime: new Date(),
              },
            });

            chan.close();
            conn.close();
            resolve(session);
          });

          chan.on("trap", (err) => {
            chan.close();
            conn.close();
            reject(err);
          });
        } catch (err) {
          conn.close();
          reject(err);
        }
      });
    });
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
          endDate: { gt: new Date() },
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
  end: async ({ macAddress }) => {
    try {
      const session = await prisma.routerSession.findFirst({
        where: { macAddress, logoutTime: null },
        include: { user: true },
      });

      if (!session) throw new Error("Session not found");

      const connection = getMikroTikConnection();

      return new Promise((resolve, reject) => {
        connection.connect(async (conn) => {
          try {
            const chan = conn.openChannel("remove-user");

            chan.write(`/ip/hotspot/user/remove`, [
              `=numbers=${session.user.username}`,
            ]);

            chan.on("done", async () => {
              const logoutTime = new Date();

              const updated = await prisma.routerSession.update({
                where: { id: session.id },
                data: {
                  logoutTime,
                  duration: differenceInMinutes(logoutTime, session.loginTime),
                  status: "INACTIVE",
                },
              });

              chan.close();
              conn.close();

              resolve(updated);
            });

            chan.on("trap", async (data) => {
              // Even if removal fails, mark session as inactive
              const logoutTime = new Date();

              const updated = await prisma.routerSession.update({
                where: { id: session.id },
                data: {
                  logoutTime,
                  duration: differenceInMinutes(logoutTime, session.loginTime),
                  status: "INACTIVE",
                },
              });

              chan.close();
              conn.close();

              resolve(updated);
            });

            chan.on("error", (err) => {
              chan.close();
              conn.close();
              reject(err);
            });
          } catch (err) {
            conn.close();
            reject(err);
          }
        });
      });
    } catch (error) {
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
          logoutTime: null,
        },
      });

      const results = [];
      for (const session of sessions) {
        try {
          const result = await this.end({ macAddress: session.macAddress });
          results.push(result);
        } catch (err) {
          console.error(`Failed to end session ${session.id}:`, err);
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
          logoutTime: null,
          subscription: {
            OR: [{ status: "EXPIRED" }, { endDate: { lt: new Date() } }],
          },
        },
      });

      const results = [];
      for (const session of expiredSessions) {
        try {
          const result = await this.end({ macAddress: session.macAddress });
          results.push(result);
        } catch (err) {
          console.error(`Failed to cleanup session ${session.id}:`, err);
        }
      }

      return results;
    } catch (error) {
      throw error;
    }
  },
};
