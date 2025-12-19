// services/subscriptionService.js
import prisma from "../config/db.js";
import { add } from "date-fns";
import { RouterSessionManager } from "./routerSessionService.js";

/**
 * Automatically creates a subscription when payment succeeds
 */
export const createSubscriptionForPayment = async (payment) => {
  try {
    // Validate payment has a plan
    if (!payment.planId) {
      console.warn("No plan linked to this payment. Subscription not created.");
      return null;
    }

    // Fetch plan details
    const plan = await prisma.plan.findUnique({
      where: { id: payment.planId },
    });

    if (!plan) {
      console.warn("Plan not found for payment:", payment.id);
      return null;
    }

    // Calculate expiry time based on duration type
    let endTime;
    const startTime = new Date();

    switch (plan.durationType) {
      case "HOUR":
        endTime = add(startTime, { hours: plan.durationValue });
        break;
      case "DAY":
        endTime = add(startTime, { days: plan.durationValue });
        break;
      case "WEEK":
        endTime = add(startTime, { weeks: plan.durationValue });
        break;
      case "MONTH":
        endTime = add(startTime, { months: plan.durationValue });
        break;
      default:
        throw new Error("Invalid duration type for plan");
    }

    // Create subscription - FIX: Store the created subscription
    const subscription = await prisma.subscription.create({
      data: {
        userId: payment.userId,
        planId: plan.id,
        startTime,
        endTime,
        paymentId: payment.id,
        status: "ACTIVE",
      },
    });

    console.log(
      `✅ Subscription created for user ${payment.userId} (Plan: ${plan.name})`
    );

    // 🚀 AUTOMATICALLY START ROUTER SESSION
    try {
      // Get user details with MAC address
      const user = await prisma.user.findUnique({
        where: { id: payment.userId },
      });

      if (!user || !user.macAddress) {
        console.warn(
          `⚠️  User ${payment.userId} has no MAC address, skipping session start`
        );
        return { subscription, session: null };
      }

      const session = await RouterSessionManager.startAutomatic({
        subscriptionId: subscription.id,
        macAddress: user.macAddress,
        ipAddress: null, // Will be assigned by router
      });

      console.log(
        `✅ Router session started automatically for user ${user.phone}`
      );

      return { subscription, session };
    } catch (sessionError) {
      console.error("Failed to start router session:", sessionError.message);

      // Subscription created but session failed - user can manually connect
      return {
        subscription,
        session: null,
        sessionError: sessionError.message,
      };
    }
  } catch (error) {
    console.error("Error creating subscription:", error);
    throw error;
  }
};
