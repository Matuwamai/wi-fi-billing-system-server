import express from "express";
import {
  registerUser,
  loginUser,
  getProfile,
  createGuestUser,
  listUsers,
} from "../controllers/user.js";
import { authenticate } from "../middlewares/auth.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/guest", createGuestUser);
router.get("/me", authenticate, getProfile);
router.get("/", authenticate, listUsers);

export default router;
