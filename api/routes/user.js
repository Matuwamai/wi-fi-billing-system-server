import express from "express";
import {
  registerUser,
  loginUser,
  getProfile,
  createGuestUser,
} from "../controllers/user.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/guest", createGuestUser); // 👈 new route
router.get("/me", authenticate, getProfile);

export default router;
