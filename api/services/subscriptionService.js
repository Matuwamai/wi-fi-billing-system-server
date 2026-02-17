// services/subscriptionService.js
import prisma from "../config/db.js";
import { RadiusManager } from "./RadiusManager.js";
import logger from "../utils/logger.js";

/**
 * Calculate subscription end time based on plan duration type & value
 */
const calcEndTime = (plan) => {
  const now = new Date();
  const ms = {
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000,
  };
  const duration = ms[plan.durationType] * plan.durationValue;
  return new Date(now.getTime() + duration);
};

/**
 * Called automatically after a successful M-Pesa payment callback.
 * 1. Creates a Subscription record
 * 2. Provisions the RADIUS user (radcheck + radreply)
 */
export const createSubscriptionForPayment = async (payment) => {
  logger.info(`🔄 Creating subscription for payment ${payment.id}`);

  // ── Fetch plan & user ──
  const [plan, user] = await Promise.all([
    prisma.plan.findUnique({ where: { id: payment.planId } }),
    prisma.user.findUnique({ where: { id: payment.userId } }),
  ]);

  if (!plan) throw new Error(`Plan ${payment.planId} not found`);
  if (!user) throw new Error(`User ${payment.userId} not found`);
  if (!user.username)
    throw new Error(
      `User ${user.id} has no username — cannot provision RADIUS`,
    );

  const endTime = calcEndTime(plan);

  // ── Create subscription ──
  const subscription = await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      paymentId: payment.id,
      startTime: new Date(),
      endTime,
      status: "ACTIVE",
    },
  });

  logger.info(
    `📋 Subscription created: ID=${subscription.id}, expires=${endTime.toISOString()}`,
  );

  // ── Provision RADIUS user ──
  try {
    // Remove any stale RADIUS entries first (safe to call even if none exist)
    await RadiusManager.deleteRadiusUser(user.username);

    await RadiusManager.createRadiusUser({
      username: user.username,
      password: user.password,
      planProfile: {
        rateLimit: plan.rateLimit || "10M/10M",
        sessionTimeout:
          plan.durationValue && plan.durationType === "MINUTE"
            ? plan.durationValue * 60
            : plan.durationType === "HOUR"
              ? plan.durationValue * 3600
              : null,
        dataLimit: plan.dataLimit || null,
      },
    });

    logger.info(`✅ RADIUS user provisioned: ${user.username}`);
  } catch (radiusErr) {
    // Log but don't fail — subscription is created, admin can reprovision
    logger.error(
      `❌ RADIUS provisioning failed for ${user.username}: ${radiusErr.message}`,
    );
  }

  return subscription;
};

/**
 * Expire a subscription: mark it EXPIRED and remove RADIUS access
 */
export const expireSubscription = async (subscriptionId) => {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { user: true },
  });

  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: "EXPIRED" },
  });

  if (sub.user?.username) {
    await RadiusManager.deleteRadiusUser(sub.user.username);
    logger.info(`🚫 RADIUS access removed for ${sub.user.username}`);
  }

  return { success: true, subscriptionId };
};

/**
 * Cron helper: expire all subscriptions past their endTime
 * Call this from a scheduled job (e.g. every 5 minutes)
 */
export const expireStaleSubscriptions = async () => {
  const expired = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      endTime: { lt: new Date() },
    },
    include: { user: true },
  });

  logger.info(`⏰ Found ${expired.length} stale subscription(s) to expire`);

  const results = await Promise.allSettled(
    expired.map((sub) => expireSubscription(sub.id)),
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    logger.warn(`⚠️ ${failed.length} subscription(s) failed to expire`);
  }

  return { expired: expired.length, failed: failed.length };
};

/**
 * Get full subscription details for a user
 */
export const getUserSubscriptions = async (userId) => {
  return prisma.subscription.findMany({
    where: { userId: Number(userId) },
    include: { plan: true, payment: true },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * Get the currently active subscription for a user (if any)
 */
export const getActiveSubscription = async (userId) => {
  return prisma.subscription.findFirst({
    where: {
      userId: Number(userId),
      status: "ACTIVE",
      endTime: { gt: new Date() },
    },
    include: { plan: true },
    orderBy: { endTime: "desc" },
  });
};
