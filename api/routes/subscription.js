// api/routes/subscriptionRoute.js
import express from "express";
import {
  createSubscription,
  getUserSubscriptions,
  getAllSubscriptions,
  checkAndExpireSubscriptions,
} from "../controllers/subscription.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

// User routes
router.post("/", authenticate, createSubscription);
router.get("/my", authenticate, getUserSubscriptions);
router.get("/user", authenticate, getUserSubscriptions);
router.get("/all", getAllSubscriptions);
// Admin routes
router.get("/", authenticate, getAllSubscriptions);
router.put("/check-expiry", authenticate, checkAndExpireSubscriptions);

export default router;
