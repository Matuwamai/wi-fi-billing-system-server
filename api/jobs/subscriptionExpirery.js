import cron from "node-cron";
import prisma from "../config/db.js";
/**
 * Auto-expire subscriptions whose endTime has passed
 */
const subscriptionExpiryJob = () => {
  // Runs every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    console.log("🔁 Checking for expired subscriptions...");

    try {
      const now = new Date();

      // Find subscriptions that should expire
      const expiredSubs = await prisma.subscription.findMany({
        where: {
          status: "ACTIVE",
          endTime: { lt: now },
        },
      });

      if (expiredSubs.length > 0) {
        const ids = expiredSubs.map((s) => s.id);

        await prisma.subscription.updateMany({
          where: { id: { in: ids } },
          data: { status: "EXPIRED" },
        });

        console.log(`✅ ${ids.length} subscriptions auto-expired.`);
      } else {
        console.log("⏳ No expired subscriptions found.");
      }
    } catch (error) {
      console.error("❌ Error running subscription expiry job:", error.message);
    }
  });
};

export default subscriptionExpiryJob;
