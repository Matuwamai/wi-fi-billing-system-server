import app from "./app.js";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 5005;
const prisma = new PrismaClient();

async function startServer() {
  try {
    await prisma.$connect(); // wait for DB
    console.log("✅ Prisma connected");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

startServer();
