import app from "./app.js";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 5005;
const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
  errorFormat: "pretty",
});

// Handle database connection errors
prisma.$on("error", (e) => {
  console.error("Prisma Client Error:", e);
});

async function startServer() {
  try {
    console.log("Attempting to connect to database...");
    await prisma.$connect();
    console.log("✅ Prisma connected successfully");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("Shutting down gracefully...");
      await prisma.$disconnect();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("Received SIGTERM");
      await prisma.$disconnect();
      process.exit(0);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    console.error("Error details:", err.message);

    // Don't exit immediately - let PM2 handle restart
    // Keep trying to reconnect
    setTimeout(() => {
      console.log("Attempting to restart...");
      startServer();
    }, 5000);
  }
}

startServer();
