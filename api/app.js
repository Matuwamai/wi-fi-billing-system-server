import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import planRoutes from "./routes/planroute.js";
import userRoutes from "./routes/user.js";
import subscriptionRoutes from "./routes/subscription.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import mpeasaRoutes from "./routes/mpesa.js";
import voucherRouetes from "./routes/voucher.js";
import autRoutes from "./routes/auth.js";
import analyticRoute from "./routes/analytics.js";
import radiusRoutes from "./routes/radius.js";
import logger from "./utils/logger.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Log every request
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use("/api/plans", planRoutes);
app.use("/api/user", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/payments", mpeasaRoutes);
app.use("/api/vouchers", voucherRouetes);
app.use("/api/auth", autRoutes);
app.use("/api/analytics", analyticRoute);
app.use("/api/radius", radiusRoutes);

// Error handler
app.use(errorHandler);

export default app;
