import { RouterOSClient } from "routeros-client";
import dotenv from "dotenv";
dotenv.config();

const routerConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  port: Number(process.env.MIKROTIK_API_PORT) || 8728,
  timeout: 20000, // 20 seconds
};

console.log("📡 MikroTik Configuration:");
console.log(`   Host: ${routerConfig.host}`);
console.log(`   User: ${routerConfig.user}`);
console.log(`   Port: ${routerConfig.port}`);

/**
 * Connect to MikroTik and return connected client
 * @returns {Promise<Object>} Connected client instance
 */
export const connectMikroTik = async () => {
  if (!routerConfig.host || !routerConfig.user) {
    throw new Error(
      "MikroTik configuration is incomplete. Check your .env file."
    );
  }

  try {
    const client = new RouterOSClient(routerConfig);
    const connectedClient = await client.connect();
    console.log("✅ Connected to MikroTik");
    return connectedClient;
  } catch (error) {
    console.error("❌ Failed to connect to MikroTik:", error.message);
    throw error;
  }
};

export default {
  connectMikroTik,
  config: routerConfig,
};
