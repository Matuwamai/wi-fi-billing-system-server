import { RouterOSClient } from "routeros-client";

const client = new RouterOSClient({
  host: "192.168.88.1",
  user: "admin",
  password: "homewifix",
  port: 8728,
  timeout: 10,
});

console.log("Connecting to MikroTik...");

client
  .connect()
  .then(async (connectedClient) => {
    console.log("✅ Connected successfully!");

    const identity = await connectedClient.menu("/system/identity").getAll();
    console.log("📡 Router Identity:", identity);

    const resources = await connectedClient.menu("/system/resource").getAll();
    console.log("💻 System Resources:", resources);

    const users = await connectedClient.menu("/ip/hotspot/user").getAll();
    console.log("👥 Hotspot Users:", users.length);

    const profiles = await connectedClient
      .menu("/ip/hotspot/user/profile")
      .getAll();
    console.log(
      "📋 Hotspot Profiles:",
      profiles.map((p) => p.name)
    );

    // Just exit, connection auto-closes
    console.log("\n✅ MikroTik connection test PASSED!");
    console.log("================================================");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Connection failed:", error.message);
    process.exit(1);
  });
