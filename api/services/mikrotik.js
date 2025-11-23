import MikroNode from "mikronode-ng";
import dotenv from "dotenv";
dotenv.config();

const routerConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  apiPort: parseInt(process.env.MIKROTIK_API_PORT) || 8728,
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
if (isNaN(routerConfig.apiPort)) {
  console.warn(
    "⚠️  MIKROTIK_API_PORT is not a valid number, using default 8728"
  );
  routerConfig.apiPort = 8728;
}

console.log("📡 MikroTik Configuration:");
console.log(`   Host: ${routerConfig.host}`);
console.log(`   User: ${routerConfig.user}`);
console.log(`   Port: ${routerConfig.apiPort}`);

export const getMikroTikConnection = () => {
  if (!routerConfig.host || !routerConfig.user || !routerConfig.password) {
    throw new Error(
      "MikroTik configuration is incomplete. Check your .env file."
    );
  }

  try {
    return MikroNode.getConnection(
      routerConfig.host,
      routerConfig.user,
      routerConfig.password,
      {
        port: routerConfig.apiPort,
        timeout: 10, // 10 seconds timeout
      }
    );
  } catch (error) {
    console.error("❌ Failed to create MikroTik connection:", error.message);
    throw error;
  }
};

export default {
  getMikroTikConnection,
  config: routerConfig,
};
