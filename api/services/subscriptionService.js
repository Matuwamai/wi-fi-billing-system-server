// services/subscriptionService.js
import prisma from "../config/db.js";
import { add } from "date-fns";
import { RouterSessionManager } from "./routerSessionService.js";

/**
 * Automatically creates a subscription when payment succeeds
 */
export const createSubscriptionForPayment = async (payment) => {
  // Get user's latest active plan or assign a default one
  // For now, we’ll assume you pass a planId when creating payment
  // (we’ll improve later to allow plan-based payments)
  if (!payment.planId) {
    console.warn("No plan linked to this payment. Subscription not created.");
    return;
  }

  // Fetch plan details
  const plan = await prisma.plan.findUnique({
    where: { id: payment.planId },
  });

  if (!plan) {
    console.warn("Plan not found for payment:", payment.id);
    return;
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

  // Create subscription
  await prisma.subscription.create({
    data: {
      userId: payment.userId,
      planId: plan.id,
      startTime,
      endTime,
      paymentId: payment.id,
      status: "ACTIVE",
    },
  });
  // 🚀 AUTOMATICALLY START ROUTER SESSION
  try {
    const session = await RouterSessionManager.startAutomatic({
      subscriptionId: subscription.id,
      macAddress: payment.user.macAddress,
      ipAddress: null, // Will be assigned by router
    });

    console.log(
      `✅ Router session started automatically for user ${payment.user.phone}`
    );

    return res.status(200).json({
      success: true,
      message: "Payment processed and session started",
      subscription,
      session,
    });
  } catch (sessionError) {
    console.error("Failed to start router session:", sessionError);

    // Subscription created but session failed - user can manually connect
    res.status(200).json({
      success: true,
      message:
        "Payment processed. Please connect manually to start using the internet.",
      subscription,
      sessionError: sessionError.message,
    });
  }

  console.log(
    `✅ Subscription created for user ${payment.userId} (Plan: ${plan.name})`
  );
};
