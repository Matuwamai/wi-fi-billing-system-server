import express from "express";
import {
  registerUser,
  loginUser,
  createGuestUser,
  loginWithMpesa,
  getMe,
} from "../controllers/auth.js";
const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/guest", createGuestUser);
router.post("/mpesa-login", loginWithMpesa);
router.get("/me", getMe);

export default router;
