import prisma from "../config/db.js";
import { getMikroTikConnection } from "./mikrotik.js";
import { differenceInMinutes } from "date-fns";

export const RouterSessionManager = {
  start: async ({ userId, macAddress, ipAddress }) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new Error("User not found");

    // Subscription validation
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        endTime: { gt: new Date() },
      },
    });

    if (!activeSub) throw new Error("No active subscription found");

    const connection = getMikroTikConnection();

    return new Promise((resolve, reject) => {
      connection.connect(async (conn) => {
        try {
          const chan = conn.openChannel("add-user");

          const profileName = activeSub.planName.replace(/\s+/g, "_");

          chan.write(`/ip/hotspot/user/add`, [
            `=name=${user.username}`,
            `=password=${user.password}`,
            `=profile=${profileName}`,
            `=comment=Sub ${activeSub.id}`,
          ]);

          chan.on("done", async () => {
            const session = await prisma.routerSession.create({
              data: {
                userId,
                subscriptionId: activeSub.id,
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

          chan.on("trap", (err) => reject(err));
        } catch (err) {
          reject(err);
        }
      });
    });
  },

  end: async ({ macAddress }) => {
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

          chan.on("trap", (err) => reject(err));
        } catch (err) {
          reject(err);
        }
      });
    });
  },
};
