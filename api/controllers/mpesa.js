import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";

export const startPayment = async (req, res) => {
  try {
    const { phone, userId, planId } = req.body;

    if (!phone || !userId || !planId)
      return res.status(400).json({ message: "Missing required fields" });
    // Fetch the plan details
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }
    const amount = plan.price;
    // Create initial payment record
    const payment = await prisma.payment.create({
      data: {
        userId,
        amount,
        planId,
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

    // 🧠 Save the returned IDs to match during callback
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        checkoutRequestId: stkResponse?.CheckoutRequestID || null,
        merchantRequestId: stkResponse?.MerchantRequestID || null,
      },
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

    const metadataItems = callback?.CallbackMetadata?.Item || [];
    const mpesaCode =
      metadataItems.find((i) => i.Name === "MpesaReceiptNumber")?.Value || null;
    const amount =
      metadataItems.find((i) => i.Name === "Amount")?.Value || null;
    const phone =
      metadataItems.find((i) => i.Name === "PhoneNumber")?.Value || null;

    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId: CheckoutRequestID },
    });

    if (!payment) {
      console.warn(
        "Payment not found for CheckoutRequestID:",
        CheckoutRequestID
      );
      return res.status(200).json({ message: "No matching payment found" });
    }

    // Update payment status
    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result,
        mpesaCode,
        callbackData: Body,
      },
    });

    // 🚀 Auto-create subscription after successful payment
    if (result === "SUCCESS") {
      await createSubscriptionForPayment(updatedPayment);
      const plan = await prisma.plan.findUnique({
        where: { id: payment.planId },
      });

      console.log(
        `✅ Subscription created for user ${payment.userId} (Plan: ${plan.name})`
      );
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Callback error:", error);
    res.sendStatus(500);
  }
};
