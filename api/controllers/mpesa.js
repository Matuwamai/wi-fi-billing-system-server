import { initiateStkPush } from "../services/mpesaService.js";
import prisma from "../config/db.js";
import { createSubscriptionForPayment } from "../services/subscriptionService.js";

/**
 * Accepts either:
 * - userId (logged-in user) OR
 * - macAddress (guest device) with optional deviceName and phone
 */
export const startPayment = async (req, res) => {
  try {
    const { phone, userId, planId, macAddress, deviceName, deviceId } =
      req.body;

    if (!planId || (!userId && !macAddress)) {
      return res
        .status(400)
        .json({ message: "Missing planId and (userId or macAddress)" });
    }

    // Fetch plan
    const plan = await prisma.plan.findUnique({
      where: { id: Number(planId) },
    });
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    // Resolve user: logged-in user has priority; otherwise find-or-create guest by macAddress or deviceId
    let user;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: Number(userId) } });
      if (!user) return res.status(404).json({ message: "User not found" });
    } else {
      // Find by deviceId if provided, else by macAddress
      const where = deviceId ? { deviceId } : { macAddress };
      user = await prisma.user.findUnique({ where });

      if (!user) {
        user = await prisma.user.create({
          data: {
            phone: phone || null,
            macAddress: macAddress || null,
            deviceName: deviceName || null,
            deviceId: deviceId || null,
            isGuest: true,
          },
        });
      } else {
        // Optionally update phone or deviceName if provided
        await prisma.user.update({
          where: { id: user.id },
          data: {
            phone: phone || user.phone,
            deviceName: deviceName || user.deviceName,
          },
        });
      }
    }

    // Create payment linked to plan and this user
    const payment = await prisma.payment.create({
      data: {
        userId: user.id,
        planId: plan.id,
        amount: plan.price,
        method: "MPESA",
        status: "PENDING",
      },
    });

    // Trigger STK push
    const stkResponse = await initiateStkPush({
      amount: plan.price,
      phone: phone || user.phone, // if no phone given, front-end must collect it
      accountRef: `WIFI-${payment.id}`,
    });

    // Save the checkoutRequestId
    if (stkResponse?.CheckoutRequestID || stkResponse?.MerchantRequestID) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          checkoutRequestId: stkResponse.CheckoutRequestID || null,
          merchantRequestId: stkResponse.MerchantRequestID || null,
        },
      });
    }

    res.status(200).json({
      message: "STK push initiated",
      payment,
      stkResponse,
      guestUser: user.isGuest
        ? { id: user.id, macAddress: user.macAddress }
        : null,
    });
    // if (result === "SUCCESS") {
    //   await createSubscriptionForPayment(updatedPayment);
    //   const plan = await prisma.plan.findUnique({
    //     where: { id: payment.planId },
    //   });

    //   console.log(
    //     `✅ Subscription created for user ${payment.userId} (Plan: ${plan.name})`
    //   );
    // }
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
