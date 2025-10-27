// api/controllers/subscriptionController.js
import prisma from "../config/db.js";
import { add } from "date-fns";

/**
 * Create a new subscription (after payment or free trial)
 */
export const createSubscription = async (req, res, next) => {
  try {
    const { planId } = req.body;
    const userId = req.user.id;

    const plan = await prisma.plan.findUnique({ where: { id: Number(planId) } });
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    // Calculate end date
    let endTime = new Date();
    switch (plan.durationType) {
      case "HOUR":
        endTime = add(new Date(), { hours: plan.durationValue });
        break;
      case "DAY":
        endTime = add(new Date(), { days: plan.durationValue });
        break;
      case "WEEK":
        endTime = add(new Date(), { weeks: plan.durationValue });
        break;
      case "MONTH":
        endTime = add(new Date(), { months: plan.durationValue });
        break;
    }

    // Create subscription record
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        endTime,
        status: "ACTIVE",
      },
      include: {
        plan: true,
      },
    });

    res.status(201).json({
      message: "Subscription created successfully",
      subscription,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user's subscriptions
 */
export const getUserSubscriptions = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(subscriptions);
  } catch (error) {
    next(error);
  }
};

/**
 * Admin — get all subscriptions
 */
export const getAllSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      include: {
        user: { select: { phone: true } },
        plan: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(subscriptions);
  } catch (error) {
    next(error);
  }
};

/**
 * Check and expire ended subscriptions (can be called by cron job)
 */
export const checkAndExpireSubscriptions = async (req, res, next) => {
  try {
    const now = new Date();

    const expired = await prisma.subscription.updateMany({
      where: {
        endTime: { lt: now },
        status: "ACTIVE",
      },
      data: { status: "EXPIRED" },
    });

    res.status(200).json({ message: "Expired subscriptions updated", expiredCount: expired.count });
  } catch (error) {
    next(error);
  }
};
