// routes/radius.routes.js
import express from "express";
import {
  listRadiusUsers,
  listActiveSessions,
  getSessionHistory,
  getRadiusUser,
  disconnectUser,
  deleteRadiusUser,
  updateUserSpeed,
  getRadiusStats,
} from "../controllers/radiusController.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

// All RADIUS management routes are admin-only
router.use(authenticate, authorizeRoles("ADMIN"));

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────
router.get("/stats", getRadiusStats);

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────
router.get("/sessions", listActiveSessions);
router.get("/sessions/history", getSessionHistory);

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────
router.get("/users", listRadiusUsers);
router.get("/users/:username", getRadiusUser);
router.delete("/users/:username", deleteRadiusUser);
router.post("/users/:username/disconnect", disconnectUser);
router.patch("/users/:username/speed", updateUserSpeed);

export default router;
