import express from "express";
import {
  registerUser,
  loginUser,
  getProfile,
  createGuestUser,
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/guest", createGuestUser); // 👈 new route
router.get("/me", authMiddleware, getProfile);

export default router;
