import express from "express";
import {
  startPayment,
  handleCallback,
  getPaymentDetails,
  listPayments,
} from "../controllers/mpesa.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

router.post("/pay", startPayment);
router.post("/callback", handleCallback);
router.get("/", authenticate, authorizeRoles("ADMIN"), listPayments);
router.get("/:id", authenticate, authorizeRoles("ADMIN"), getPaymentDetails);

export default router;
