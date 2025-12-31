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
router.get("/:id", getPlanById);
router.put("/:id", updatePlan);
router.delete("/:id", deletePlan);

export default router;
