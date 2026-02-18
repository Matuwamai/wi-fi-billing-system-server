import express from "express";
import {
  updateUser,
  unblockUser,
  blockUser,
  deleteUser,
  getUser,
  listUsers,
} from "../controllers/user.js";
import { authenticate, authorizeRoles } from "../middlewares/auth.js";

const router = express.Router();

router.put("/profile/:id", authenticate, updateUser);
router.put("/block/:id", authenticate, authorizeRoles("ADMIN"), blockUser);
router.put("/unblock/:id", authenticate, authorizeRoles("ADMIN"), unblockUser);
router.delete(
  "/profile/:id",
  authenticate,
  authorizeRoles("ADMIN"),
  deleteUser,
);
router.get("/profile/:id", getUser);
router.get("/", authenticate, authorizeRoles("ADMIN"), listUsers);

export default router;
