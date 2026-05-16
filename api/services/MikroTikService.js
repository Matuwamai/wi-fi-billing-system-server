// services/MikroTikService.js
import { RouterOSAPI } from "routeros-api";

class MikroTikService {
  constructor() {
    this.config = {
      host: process.env.MIKROTIK_HOST || "192.168.88.1",
      user: process.env.MIKROTIK_USER || "admin",
      password: process.env.MIKROTIK_PASS || "homewifix",
      port: parseInt(process.env.MIKROTIK_API_PORT) || 8728,
      timeout: 10000,
    };
    this.conn = null;
  }

  async connect() {
    try {
      this.conn = new RouterOSAPI(this.config);
      await this.conn.connect();
      console.log("✅ Connected to MikroTik API");
      return true;
    } catch (error) {
      console.error("❌ MikroTik API connection failed:", error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }

  /**
   * Add hotspot user after voucher redemption
   */
  async addHotspotUser(
    username,
    password,
    macAddress = null,
    planDuration = "1h",
  ) {
    try {
      await this.connect();

      // Check if user already exists
      const existingUsers = await this.conn.write("/ip/hotspot/user/print", {
        "?name": username,
      });

      let result;
      if (existingUsers && existingUsers.length > 0) {
        // Update existing user
        result = await this.conn.write("/ip/hotspot/user/set", {
          ".id": username,
          password: password,
          "limit-uptime": planDuration,
        });
        console.log(`🔄 Updated hotspot user: ${username}`);
      } else {
        // Create new hotspot user
        result = await this.conn.write("/ip/hotspot/user/add", {
          name: username,
          password: password,
          profile: "default",
          "limit-uptime": planDuration,
        });
        console.log(`✅ Created hotspot user: ${username}`);
      }

      // If MAC address provided, add to walled garden for auto-login
      if (macAddress && macAddress !== "00:00:00:00:00:00") {
        await this.addMacToWalledGarden(macAddress, username);
      }

      return { success: true, username, macAddress };
    } catch (error) {
      console.error("❌ Failed to add hotspot user:", error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Add MAC address to walled garden for auto-login
   */
  async addMacToWalledGarden(macAddress, username) {
    try {
      // Format MAC address (MikroTik expects uppercase with colons)
      const formattedMac = macAddress.toUpperCase().replace(/-/g, ":");

      // Check if already exists
      const existing = await this.conn.write(
        "/ip/hotspot/walled-garden/print",
        {
          "?mac-address": formattedMac,
        },
      );

      if (!existing || existing.length === 0) {
        await this.conn.write("/ip/hotspot/walled-garden/add", {
          "mac-address": formattedMac,
          action: "accept",
          comment: `Auto-added for user: ${username}`,
        });
        console.log(
          `✅ MAC ${formattedMac} added to walled garden for auto-login`,
        );
      }
    } catch (error) {
      console.error("❌ Failed to add MAC to walled garden:", error);
    }
  }

  /**
   * Remove hotspot user (when subscription expires)
   */
  async removeHotspotUser(username) {
    try {
      await this.connect();

      // Get user to find associated MAC
      const users = await this.conn.write("/ip/hotspot/user/print", {
        "?name": username,
      });

      // Remove the user
      await this.conn.write("/ip/hotspot/user/remove", {
        ".id": username,
      });

      console.log(`✅ Removed hotspot user: ${username}`);
      return { success: true };
    } catch (error) {
      console.error("❌ Failed to remove hotspot user:", error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Get active hotspot sessions
   */
  async getActiveSessions() {
    try {
      await this.connect();
      const active = await this.conn.write("/ip/hotspot/active/print");
      return active;
    } catch (error) {
      console.error("❌ Failed to get active sessions:", error);
      return [];
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Disconnect a specific user
   */
  async disconnectUser(username) {
    try {
      await this.connect();
      await this.conn.write("/ip/hotspot/active/remove", {
        ".id": username,
      });
      console.log(`🔌 Disconnected user: ${username}`);
      return { success: true };
    } catch (error) {
      console.error("❌ Failed to disconnect user:", error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Test connection to MikroTik
   */
  async testConnection() {
    try {
      await this.connect();
      const identity = await this.conn.write("/system/identity/print");
      console.log("✅ MikroTik connection successful!");
      console.log("Router Identity:", identity[0]?.name || "Unknown");
      return true;
    } catch (error) {
      console.error("❌ MikroTik connection failed:", error.message);
      return false;
    } finally {
      await this.disconnect();
    }
  }
}

export default new MikroTikService();
