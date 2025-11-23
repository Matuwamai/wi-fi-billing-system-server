import { getMikroTikConnection } from "../services/mikrotik.js";

/**
 * Test MikroTik connection and retrieve system information
 */
export const testMikroTikConnection = async () => {
  console.log("🔄 Testing MikroTik connection...");
  console.log("📋 Configuration:");
  console.log(`   Host: ${process.env.MIKROTIK_HOST}`);
  console.log(`   User: ${process.env.MIKROTIK_USER}`);
  console.log(`   Port: ${process.env.MIKROTIK_API_PORT || 8728}`);
  console.log("");

  // Validate configuration
  if (!process.env.MIKROTIK_HOST) {
    throw new Error("MIKROTIK_HOST is not defined in .env");
  }
  if (!process.env.MIKROTIK_USER) {
    throw new Error("MIKROTIK_USER is not defined in .env");
  }
  if (!process.env.MIKROTIK_PASS) {
    throw new Error("MIKROTIK_PASS is not defined in .env");
  }

  const connection = getMikroTikConnection();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log("❌ Connection timeout after 10 seconds");
      reject(
        new Error(
          "Connection timeout - check if MikroTik API is enabled and accessible"
        )
      );
    }, 10000);

    try {
      connection.connect((conn) => {
        clearTimeout(timeout);

        if (!conn) {
          console.log("❌ Failed to establish connection");
          reject(
            new Error("Connection failed - no connection object returned")
          );
          return;
        }

        console.log("✅ Connected to MikroTik router!");
        console.log("");

        // Get system identity
        const identityChannel = conn.openChannel("identity");

        identityChannel.write("/system/identity/print", []);

        identityChannel.on("done", (data) => {
          try {
            const identity = data?.identity || data?.[0]?.identity || "Unknown";
            console.log(`📡 Router Identity: ${identity}`);
            identityChannel.close();

            // Get system resources
            const resourceChannel = conn.openChannel("resource");
            resourceChannel.write("/system/resource/print", []);

            resourceChannel.on("done", (resourceData) => {
              try {
                const resource = Array.isArray(resourceData)
                  ? resourceData[0]
                  : resourceData;
                console.log("");
                console.log("💻 System Resources:");
                console.log(`   Version: ${resource?.version || "Unknown"}`);
                console.log(
                  `   Board: ${resource?.["board-name"] || "Unknown"}`
                );
                console.log(`   Uptime: ${resource?.uptime || "Unknown"}`);
                console.log(
                  `   CPU Load: ${resource?.["cpu-load"] || "Unknown"}%`
                );
                console.log(
                  `   Free Memory: ${resource?.["free-memory"] || "Unknown"}`
                );
                console.log(
                  `   Total Memory: ${resource?.["total-memory"] || "Unknown"}`
                );
                resourceChannel.close();

                // Get hotspot users
                const usersChannel = conn.openChannel("users");
                usersChannel.write("/ip/hotspot/user/print", []);

                usersChannel.on("done", (usersData) => {
                  try {
                    const userCount = Array.isArray(usersData)
                      ? usersData.length
                      : 0;
                    console.log("");
                    console.log("👥 Hotspot Users:");
                    console.log(`   Total Users: ${userCount}`);

                    if (Array.isArray(usersData) && usersData.length > 0) {
                      console.log("   Recent Users:");
                      usersData.slice(0, 5).forEach((user) => {
                        console.log(
                          `     - ${user.name} (${
                            user.profile || "no profile"
                          })`
                        );
                      });
                    }
                    usersChannel.close();

                    // Get hotspot profiles
                    const profilesChannel = conn.openChannel("profiles");
                    profilesChannel.write("/ip/hotspot/user/profile/print", []);

                    profilesChannel.on("done", (profilesData) => {
                      try {
                        console.log("");
                        console.log("📋 Available Hotspot Profiles:");
                        if (
                          Array.isArray(profilesData) &&
                          profilesData.length > 0
                        ) {
                          profilesData.forEach((profile) => {
                            console.log(`   - ${profile.name}`);
                          });
                        } else {
                          console.log(
                            "   No profiles found (you may need to create them)"
                          );
                        }
                        profilesChannel.close();

                        console.log("");
                        console.log(
                          "✅ MikroTik connection test completed successfully!"
                        );
                        console.log(
                          "================================================"
                        );

                        conn.close();
                        resolve({
                          success: true,
                          identity,
                          resources: resource,
                          usersCount: userCount,
                          profiles: profilesData || [],
                        });
                      } catch (err) {
                        profilesChannel.close();
                        conn.close();
                        reject(err);
                      }
                    });

                    profilesChannel.on("trap", (err) => {
                      console.log(
                        "⚠️  Could not retrieve profiles:",
                        err.toString()
                      );
                      profilesChannel.close();
                      conn.close();
                      resolve({
                        success: true,
                        warning:
                          "Could not retrieve profiles - they may not exist yet",
                      });
                    });

                    profilesChannel.on("error", (err) => {
                      console.log("⚠️  Profile error:", err.toString());
                      profilesChannel.close();
                      conn.close();
                      resolve({ success: true, warning: "Profile error" });
                    });
                  } catch (err) {
                    usersChannel.close();
                    conn.close();
                    reject(err);
                  }
                });

                usersChannel.on("trap", (err) => {
                  console.log("⚠️  Could not list users:", err.toString());
                  usersChannel.close();
                  conn.close();
                  resolve({ success: true, warning: "Could not list users" });
                });

                usersChannel.on("error", (err) => {
                  console.log("⚠️  Users error:", err.toString());
                  usersChannel.close();
                  conn.close();
                  resolve({ success: true, warning: "Users error" });
                });
              } catch (err) {
                resourceChannel.close();
                conn.close();
                reject(err);
              }
            });

            resourceChannel.on("trap", (err) => {
              console.log("⚠️  Could not retrieve resources:", err.toString());
              resourceChannel.close();
              conn.close();
              resolve({
                success: true,
                warning: "Could not retrieve resources",
              });
            });

            resourceChannel.on("error", (err) => {
              console.log("⚠️  Resource error:", err.toString());
              resourceChannel.close();
              conn.close();
              resolve({ success: true, warning: "Resource error" });
            });
          } catch (err) {
            identityChannel.close();
            conn.close();
            reject(err);
          }
        });

        identityChannel.on("trap", (err) => {
          console.log("❌ Failed to get router identity:", err.toString());
          identityChannel.close();
          conn.close();
          reject(new Error(`Failed to get identity: ${err.toString()}`));
        });

        identityChannel.on("error", (err) => {
          console.log("❌ Identity channel error:", err.toString());
          identityChannel.close();
          conn.close();
          reject(new Error(`Identity error: ${err.toString()}`));
        });
      });

      connection.on("error", (err) => {
        clearTimeout(timeout);
        console.log("❌ Connection error:", err.message || err.toString());
        reject(new Error(`Connection error: ${err.message || err.toString()}`));
      });
    } catch (err) {
      clearTimeout(timeout);
      console.log("❌ Exception during connection:", err.message);
      reject(err);
    }
  });
};

/**
 * Express endpoint for testing connection
 */
export const testConnectionEndpoint = async (req, res) => {
  try {
    const result = await testMikroTikConnection();
    res.status(200).json({
      success: true,
      message: "Successfully connected to MikroTik",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to connect to MikroTik",
      error: error.message,
    });
  }
};

/**
 * Simple connection test (just verify connection)
 */
export const simpleConnectionTest = async () => {
  console.log("🔄 Testing MikroTik connection...");

  if (
    !process.env.MIKROTIK_HOST ||
    !process.env.MIKROTIK_USER ||
    !process.env.MIKROTIK_PASS
  ) {
    throw new Error("Missing MikroTik configuration in .env file");
  }

  const connection = getMikroTikConnection();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connection timeout"));
    }, 5000);

    try {
      connection.connect((conn) => {
        clearTimeout(timeout);

        if (!conn) {
          reject(new Error("Connection failed"));
          return;
        }

        console.log("✅ Successfully connected to MikroTik!");
        conn.close();
        resolve({ success: true, message: "Connected successfully" });
      });

      connection.on("error", (err) => {
        clearTimeout(timeout);
        console.log("❌ Connection error:", err.message || err.toString());
        reject(new Error(`Connection error: ${err.message || err.toString()}`));
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
};

// If running this file directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  testMikroTikConnection()
    .then(() => {
      console.log("\n✅ Test completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Test failed:", error.message);
      process.exit(1);
    });
}
