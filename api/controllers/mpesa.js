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

    const callback = Body.stkCallback;
    const { CheckoutRequestID, ResultCode } = callback;
    const result = ResultCode === 0 ? "SUCCESS" : "FAILED";

    // Extract metadata safely
    const metadataItems = callback?.CallbackMetadata?.Item || [];
    const mpesaCode = metadataItems.find(i => i.Name === "MpesaReceiptNumber")?.Value || null;
    const amount = metadataItems.find(i => i.Name === "Amount")?.Value || null;
    const phone = metadataItems.find(i => i.Name === "PhoneNumber")?.Value || null;

    // Find the exact payment by CheckoutRequestID
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    if (!payment) {
      console.warn("Payment not found for CheckoutRequestID:", CheckoutRequestID);
      // Optionally: try fallback matching (user+amount+pending) or log for manual handling
      return res.status(200).json({ message: "No matching payment found" });
    }

    // Update only the found payment
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result,
        mpesaCode,
        callbackData: Body,
      },
    });

    // Optionally: create subscription here if result === "SUCCESS"
    // await createSubscriptionForPayment(payment, ...)

    res.sendStatus(200);
  } catch (error) {
    console.error("Callback error:", error);
    res.sendStatus(500);
  }
};


