import MikroNode from "mikronode-ng";
import prisma from "../config/db.js";

// Router connection credentials
const routerConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  apiPort: process.env.MIKROTIK_API_PORT,
};

export const createRouterSession = async ({
  userId,
  planId,
  subscriptionId,
}) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const plan = await prisma.plan.findUnique({ where: { id: planId } });

  if (!user || !plan) throw new Error("User or Plan not found");

  const connection = MikroNode.getConnection(
    routerConfig.host,
    routerConfig.user,
    routerConfig.password
  );

  return new Promise((resolve, reject) => {
    connection.connect(async (conn) => {
      try {
        const chan = conn.openChannel("add-user");
        const profileName = plan.name.replace(/\s+/g, "_");

        // Add user to MikroTik hotspot
        chan.write(`/ip/hotspot/user/add`, [
          `=name=${user.username}`,
          `=password=${user.password}`,
          `=profile=${profileName}`,
          `=comment=Subscription ${subscriptionId}`,
        ]);

        chan.on("done", async () => {
          await prisma.routerSession.create({
            data: {
              userId,
              planId,
              subscriptionId,
              status: "ACTIVE",
              startedAt: new Date(),
            },
          });
          chan.close();
          conn.close();
          resolve(true);
        });

        chan.on("trap", (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  });
};
export const disableRouterSession = async (routerSession) => {
  const user = await prisma.user.findUnique({
    where: { id: routerSession.userId },
  });

  if (!user) throw new Error("User not found for router session");

  const connection = MikroNode.getConnection(
    routerConfig.host,
    routerConfig.user,
    routerConfig.password
  );

  return new Promise((resolve, reject) => {
    connection.connect(async (conn) => {
      try {
        const chan = conn.openChannel("remove-user");

        // Remove user from MikroTik Hotspot
        chan.write(`/ip/hotspot/user/remove`, [`=numbers=${user.username}`]);

        chan.on("done", async () => {
          await prisma.routerSession.update({
            where: { id: routerSession.id },
            data: {
              status: "INACTIVE",
              endedAt: new Date(),
            },
          });
          chan.close();
          conn.close();
          console.log(`🚫 Disabled router session for user: ${user.username}`);
          resolve(true);
        });

        chan.on("trap", (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  });
};
