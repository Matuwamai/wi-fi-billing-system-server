import prisma from "../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

//  Create Guest User (auto-generated for short-time users)
export const createGuestUser = async (req, res, next) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res
        .status(400)
        .json({ success: false, message: "Device ID is required" });
    }

    // Check if guest already exists
    let user = await prisma.user.findUnique({
      where: { deviceId },
    });

    // If not found, create a new guest user
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: `guest_${deviceId}`,
          password: await bcrypt.hash("guest_temp", 10),
          deviceId,
          isGuest: true,
        },
      });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" });

    res.status(200).json({
      success: true,
      message: "Guest user ready",
      user: {
        id: user.id,
        phone: user.phone,
        deviceId: user.deviceId,
        isGuest: user.isGuest,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
};

//  Register user (for regular users)
export const registerUser = async (req, res, next) => {
  try {
    const { phone, macAddress, password } = req.body;

    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { phone, macAddress, password: hashedPassword, isGuest: false },
    });

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user.id,
        phone: user.phone,
        macAddress: user.macAddress,
        isGuest: user.isGuest,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
};

//  Login user
export const loginUser = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        phone: user.phone,
        macAddress: user.macAddress,
        isGuest: user.isGuest,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
};

//  Get User Profile
export const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { subscriptions: true, payments: true },
    });

    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};
