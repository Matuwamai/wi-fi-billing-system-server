// services/subscriptionService.js
import prisma from "../config/db.js";
import { add } from "date-fns";

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
  await createRouterSession({
    userId: payment.userId,
    planId: payment.planId,
    subscriptionId: subscription.id,
  });
  console.log(
    `✅ Subscription created for user ${payment.userId} (Plan: ${plan.name})`
  );
};
