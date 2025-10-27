// api/routes/userRoute.js
import express from "express";
import {
  registerUser,
  loginUser,
  getProfile,
} from "../controllers/user.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticate, getProfile);

export default router;
