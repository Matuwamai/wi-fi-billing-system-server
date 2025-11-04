import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import planRoutes from "./routes/planroute.js";
import userRoutes from "./routes/user.js";
import subscriptionRoutes from "./routes/subscription.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import mpeasaRoutes from "./routes/mpesa.js";
import routerSessionRoutes from "./routes/routerSession.js";
import logger from "./utils/logger.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

// Routes
// Log every request
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});
app.use("/api/plans", planRoutes);
app.use("/api/users", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/session", routerSessionRoutes);
app.use("/api/mpesa", mpeasaRoutes);

// Error handler
app.use(errorHandler);

export default app;
