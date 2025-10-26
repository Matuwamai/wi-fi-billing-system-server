import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import planRoutes from "./routes/planRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

// Error handler
app.use(errorHandler);

export default app;
