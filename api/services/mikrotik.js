import { RouterOSClient } from "routeros-client";
import dotenv from "dotenv";
dotenv.config();

const routerConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  port: parseInt(process.env.MIKROTIK_API_PORT) || 8728,
  timeout: 10,
};

// Validate configuration on import
if (!routerConfig.host) {
  console.warn("⚠️  MIKROTIK_HOST is not configured in .env");
}
if (!routerConfig.user) {
  console.warn("⚠️  MIKROTIK_USER is not configured in .env");
}
if (!routerConfig.password) {
  console.warn("⚠️  MIKROTIK_PASS is not configured in .env");
}

// Ensure port is a valid number
if (isNaN(routerConfig.port)) {
  console.warn(
    "⚠️  MIKROTIK_API_PORT is not a valid number, using default 8728"
  );
  routerConfig.port = 8728;
}

console.log("📡 MikroTik Configuration:");
console.log(`   Host: ${routerConfig.host}`);
console.log(`   User: ${routerConfig.user}`);
console.log(`   Port: ${routerConfig.port}`);

/**
 * Get a new MikroTik client instance
 * @returns {RouterOSClient} MikroTik client instance
 */
export const getMikroTikClient = () => {
  if (!routerConfig.host || !routerConfig.user) {
    throw new Error(
      "MikroTik configuration is incomplete. Check your .env file."
    );
  }

  try {
    return new RouterOSClient(routerConfig);
  } catch (error) {
    console.error("❌ Failed to create MikroTik client:", error.message);
    throw error;
  }
};

/**
 * Connect to MikroTik and return connected client
 * @returns {Promise<Object>} Connected client instance with menu() method
 */
export const connectMikroTik = async () => {
  const client = getMikroTikClient();
  try {
    const connectedClient = await client.connect();
    console.log("✅ Connected to MikroTik");
    return connectedClient; // Return the connected client, not the original
  } catch (error) {
    console.error("❌ Failed to connect to MikroTik:", error.message);
    throw error;
  }
};

export default {
  getMikroTikClient,
  connectMikroTik,
  config: routerConfig,
};
