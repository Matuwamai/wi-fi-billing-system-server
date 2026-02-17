// routes/subscription.routes.js
import express from "express";
import {
  listSubscriptions,
  getMySubscriptions,
  getMyActiveSubscription,
  getSubscription,
  manualExpire,
  runExpireStale,
  getSubscriptionUsage,
} from "../controllers/subscriptionController.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();
router.use(authenticate);
// ─────────────────────────────────────────────
// USER routes
// ─────────────────────────────────────────────
router.get("/my", getMySubscriptions);
router.get("/my/active", getMyActiveSubscription);
router.get("/:id", getSubscription);
router.get("/:id/usage", getSubscriptionUsage);
// ─────────────────────────────────────────────
// ADMIN routes
// ─────────────────────────────────────────────
router.get("/", authorizeRoles("ADMIN"), listSubscriptions);
router.post("/:id/expire", authorizeRoles("ADMIN"), manualExpire);
router.post("/expire-stale", authorizeRoles("ADMIN"), runExpireStale);

export default router;
