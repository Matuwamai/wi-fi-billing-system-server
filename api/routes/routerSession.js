import express from "express";
import { startSession, endSession } from "../controllers/routerSession.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

router.post("/start", authenticate, authorizeRoles("ADMIN"), startSession);
router.post("/end", authenticate, authorizeRoles("ADMIN"), endSession);

export default router;
