import express from "express";
import {
  registerUser,
  loginUser,
  createGuestUser,
  loginWithMpesa,
  getMe,
  loginAdmin,
} from "../controllers/auth.js";
const router = express.Router();

router.post("/register", registerUser);
router.post("/admin-login", loginAdmin);
router.post("/login", loginUser);
router.post("/guest", createGuestUser);
router.post("/mpesa-login", loginWithMpesa);
router.get("/me", getMe);

export default router;
