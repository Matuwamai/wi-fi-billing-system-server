import prisma from "../config/db.js";
import { addMinutes, differenceInMinutes } from "date-fns";

// Start a new session when user logs in
export const startSession = async (req, res) => {
  try {
    const { userId, macAddress, ipAddress } = req.body;

    if (!userId || !macAddress)
      return res.status(400).json({ message: "Missing required fields" });

    // Ensure the user has an active subscription
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        endTime: { gt: new Date() },
      },
    });

    if (!activeSub)
      return res.status(403).json({
        message: "No active subscription found. Please subscribe first.",
      });

    // Create a router session
    const session = await prisma.routerSession.create({
      data: {
        userId,
        macAddress,
        ipAddress,
      },
    });

    res.status(201).json({
      message: "Session started successfully",
      session,
    });
  } catch (error) {
    console.error("Start session error:", error);
    res.status(500).json({ message: "Failed to start session", error: error.message });
  }
};

// End a session (manual or auto)
export const endSession = async (req, res) => {
  try {
    const { macAddress } = req.body;

    if (!macAddress)
      return res.status(400).json({ message: "MAC address required" });

    const session = await prisma.routerSession.findFirst({
      where: { macAddress, logoutTime: null },
    });

    if (!session)
      return res.status(404).json({ message: "Active session not found" });

    const logoutTime = new Date();
    const duration = differenceInMinutes(logoutTime, session.loginTime);

    const updated = await prisma.routerSession.update({
      where: { id: session.id },
      data: { logoutTime, duration },
    });

    res.status(200).json({
      message: "Session ended successfully",
      session: updated,
    });
  } catch (error) {
    console.error("End session error:", error);
    res.status(500).json({ message: "Failed to end session", error: error.message });
  }
};

// Check and auto-end expired sessions (cron job will call this)
export const autoExpireSessions = async () => {
  const now = new Date();

  const expiredSubs = await prisma.subscription.findMany({
    where: {
      endTime: { lt: now },
      status: "ACTIVE",
    },
    select: { userId: true },
  });

  for (const { userId } of expiredSubs) {
    const activeSessions = await prisma.routerSession.findMany({
      where: { userId, logoutTime: null },
    });

    for (const s of activeSessions) {
      await prisma.routerSession.update({
        where: { id: s.id },
        data: {
          logoutTime: now,
          duration: differenceInMinutes(now, s.loginTime),
        },
      });
      console.log(`🛑 Ended expired session for user ${userId}`);
    }
  }
};
