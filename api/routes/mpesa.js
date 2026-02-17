// routes/payment.routes.js
import express from "express";
import {
  startPayment,
  handleCallback,
  listPayments,
  getPaymentDetails,
  checkPaymentStatus,
} from "../controllers/paymentController.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();
// ─────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────
router.post("/initiate", startPayment);
router.post("/callback", handleCallback);
router.get("/status/:checkoutRequestId", checkPaymentStatus);

// ─────────────────────────────────────────────
// ADMIN ONLY
// ─────────────────────────────────────────────

router.get("/", authenticate, authorizeRoles("ADMIN"), listPayments);
router.get("/:id", authenticate, authorizeRoles("ADMIN"), getPaymentDetails);

export default router;
