import { RouterSessionManager } from "../services/routerSessionService.js";
export const startSession = async (req, res) => {
  try {
    const { userId, macAddress, ipAddress } = req.body;

    const session = await RouterSessionManager.start({
      userId,
      macAddress,
      ipAddress,
    });

    res.status(201).json({ message: "Session started", session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const endSession = async (req, res) => {
  try {
    const { macAddress } = req.body;

    const session = await RouterSessionManager.end({ macAddress });

    res.status(200).json({
      message: "Session ended",
      session,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
