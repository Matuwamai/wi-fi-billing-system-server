// routes/analytics.routes.js
import express from "express";
import {
  getDashboardAnalytics,
  getRevenueTrends,
  getSubscriptionAnalytics,
  getUserGrowth,
  getTopPlans,
  getPaymentMethodsAnalytics,
} from "../controllers/analytics.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate, authorizeRoles("ADMIN"));

// Dashboard overview
router.get("/dashboard", getDashboardAnalytics);

// Revenue trends by period (daily, weekly, monthly)
router.get("/revenue-trends", getRevenueTrends);

// Subscription analytics
router.get("/subscriptions", getSubscriptionAnalytics);

// User growth analytics
router.get("/user-growth", getUserGrowth);

// Top performing plans
router.get("/top-plans", getTopPlans);

// Payment methods analytics
router.get("/payment-methods", getPaymentMethodsAnalytics);

export default router;
