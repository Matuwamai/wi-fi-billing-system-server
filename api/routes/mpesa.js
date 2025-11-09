import express from "express";
import {
  startPayment,
  handleCallback,
  getPaymentDetails,
  listPayments,
} from "../controllers/mpesa.js";

const router = express.Router();

router.post("/pay", startPayment);
router.post("/callback", handleCallback);
router.get("/", listPayments);
router.get("/:paymentId", getPaymentDetails);

export default router;
