import cron from "node-cron";
import prisma from "../config/db.js";
import { disableRouterSession } from "../services/routerSession.js";

// Run every 60 minutes
cron.schedule("*/60 * * * *", async () => {
  console.log("🔁 Checking for expired subscriptions...");

  const now = new Date();

  // 1️⃣ Find all active subscriptions that have expired
  const expiredSubs = await prisma.subscription.findMany({
    where: {
      endDate: { lt: now },
      status: "ACTIVE",
    },
    include: { user: true, routerSession: true },
  });

  if (expiredSubs.length === 0) {
    console.log("⏳ No expired subscriptions found.");
    return;
  }

  for (const sub of expiredSubs) {
    try {
      console.log(`⚠️ Expiring subscription for user ${sub.user.username}`);

      // 2️⃣ Mark subscription as expired
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "EXPIRED" },
      });

      // 3️⃣ Disable router session if exists
      if (sub.routerSession?.id) {
        await disableRouterSession(sub.routerSession);
      }
    } catch (error) {
      console.error("Error disabling router session:", error);
    }
  }
});
