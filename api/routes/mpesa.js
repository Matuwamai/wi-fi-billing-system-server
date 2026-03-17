// routes/payment.routes.js
import express from "express";
import {
  startPayment,
  handlePaystackWebhook,
  listPayments,
  getPaymentDetails,
  checkPaymentStatus,
} from "../controllers/mpesa.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();
// ─────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────
router.post("/initiate", startPayment);
router.post("/callback", handlePaystackWebhook);
router.get("/status/:checkoutRequestId", checkPaymentStatus);

// ─────────────────────────────────────────────
// ADMIN ONLY
// ─────────────────────────────────────────────

router.get("/", authenticate, authorizeRoles("ADMIN"), listPayments);
router.get("/:id", authenticate, authorizeRoles("ADMIN"), getPaymentDetails);

export default router;
