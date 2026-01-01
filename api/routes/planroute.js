import express from "express";
import {
  getPlans,
  createPlan,
  getPlanById,
  updatePlan,
  deletePlan,
} from "../controllers/plancontroller.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

router.get("/", getPlans);
router.post("/", authenticate, authorizeRoles("ADMIN"), createPlan);
router.get("/:id", authenticate, getPlanById);
router.put("/:id", authenticate, authorizeRoles("ADMIN"), updatePlan);
router.delete("/:id", authenticate, authorizeRoles("ADMIN"), deletePlan);

export default router;
