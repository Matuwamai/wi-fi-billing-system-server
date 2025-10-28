import express from "express";
import { startPayment, handleCallback } from "../controllers/mpesa.js";

const router = express.Router();

router.post("/pay", startPayment);
router.post("/callback", handleCallback);

export default router;
