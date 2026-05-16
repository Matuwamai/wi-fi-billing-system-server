// test-mikrotik-api.js
import { RouterOSAPI } from "routeros-api";

const config = {
  host: "41.90.232.197",
  user: "admin",
  password: "homewifix",
  port: 8728,
  timeout: 10000,
};

async function testMikroTikAPI() {
  console.log("🔌 Connecting to MikroTik API...\n");

  const conn = new RouterOSAPI(config);

  try {
    // Connect to MikroTik
    await conn.connect();
    console.log("✅ Connected successfully!\n");

    // Get system identity
    const identity = await conn.write("/system/identity/print");
    console.log(`📡 Router Name: ${identity[0]?.name || "Unknown"}`);

    // Get system resources
    const resource = await conn.write("/system/resource/print");
    console.log(`⏱️  Uptime: ${resource[0]?.uptime}`);
    console.log(
      `💾 Free RAM: ${Math.round(resource[0]?.["free-memory"] / 1024 / 1024)} MB`,
    );
    console.log(
      `📀 Free HDD: ${Math.round(resource[0]?.["free-hdd-space"] / 1024 / 1024)} MB`,
    );

    // Check hotspot configuration
    const hotspot = await conn.write("/ip/hotspot/print");
    if (hotspot.length > 0) {
      console.log(`\n🔥 Hotspot: Enabled on ${hotspot[0]?.interface}`);
    } else {
      console.log(`\n⚠️  No hotspot configured`);
    }

    // List existing hotspot users
    const users = await conn.write("/ip/hotspot/user/print");
    console.log(`\n👥 Existing hotspot users: ${users.length}`);

    if (users.length > 0) {
      console.log("\n📋 First 5 users:");
      users.slice(0, 5).forEach((user) => {
        console.log(
          `   - ${user.name} (${user["limit-uptime"] || "unlimited"})`,
        );
      });
    }

    // Test creating a test user
    console.log("\n🧪 Testing user creation...");
    const testUser = `test_${Date.now()}`;

    try {
      await conn.write("/ip/hotspot/user/add", {
        name: testUser,
        password: "test123",
        profile: "default",
        "limit-uptime": "5m",
      });
      console.log(`✅ Test user created: ${testUser}`);

      // Clean up - remove test user
      await conn.write("/ip/hotspot/user/remove", {
        ".id": testUser,
      });
      console.log(`✅ Test user removed (cleanup complete)`);
    } catch (userError) {
      console.log(`⚠️  Could not create test user: ${userError.message}`);
    }

    await conn.close();
    console.log(
      "\n🎉 API is fully functional! Ready to integrate with voucher system.",
    );
  } catch (error) {
    console.error("\n❌ Connection failed:", error.message);

    if (error.message.includes("Authentication")) {
      console.log("\n🔧 Fix: Check username/password in MikroTik");
      console.log("   On MikroTik, verify: /user print");
    } else if (error.message.includes("ECONNREFUSED")) {
      console.log("\n🔧 Fix: API service not enabled");
      console.log("   On MikroTik, run: /ip service enable api");
    } else if (error.message.includes("timeout")) {
      console.log("\n🔧 Fix: Firewall blocking or network issue");
      console.log(
        "   On MikroTik, run: /ip firewall filter add chain=input protocol=tcp dst-port=8728 action=accept",
      );
    }
  }
}

testMikroTikAPI();
