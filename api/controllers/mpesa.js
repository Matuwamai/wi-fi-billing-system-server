import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";

export const startPayment = async (req, res) => {
  try {
    const { phone, amount, userId } = req.body;

    if (!phone || !amount || !userId)
      return res.status(400).json({ message: "Missing required fields" });

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        userId,
        amount,
        method: "MPESA",
        status: "PENDING",
      },
    });

    // Trigger STK push
    const stkResponse = await initiateStkPush({
      amount,
      phone,
      accountRef: `WIFI-${payment.id}`,
    });

    res.status(200).json({
      message: "STK push initiated",
      payment,
      stkResponse,
    });
  } catch (error) {
    console.error("STK push error:", error.response?.data || error.message);
    res.status(500).json({ message: "STK push failed", error: error.message });
  }
};
export const handleCallback = async (req, res) => {
  try {
    const { Body } = req.body;

    if (!Body?.stkCallback) return res.sendStatus(400);

    const { MerchantRequestID, CheckoutRequestID, ResultCode, CallbackMetadata } = Body.stkCallback;

    const result = ResultCode === 0 ? "SUCCESS" : "FAILED";
    const mpesaCode = CallbackMetadata?.Item?.find(i => i.Name === "MpesaReceiptNumber")?.Value;
    const amount = CallbackMetadata?.Item?.find(i => i.Name === "Amount")?.Value;

    // Update payment
    await prisma.payment.updateMany({
      where: { mpesaCode: null },
      data: {
        status: result,
        mpesaCode: mpesaCode || null,
        callbackData: Body,
      },
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Callback error:", error.message);
    res.sendStatus(500);
  }
};

