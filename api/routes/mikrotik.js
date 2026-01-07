// Add this to your Express server

// GET endpoint for MikroTik to fetch active users
app.get("/api/mikrotik/sync", async (req, res) => {
  try {
    // Validate request (optional but recommended)
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== process.env.MIKROTIK_SYNC_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get all active subscriptions with user details
    const activeUsers = await new Promise((resolve, reject) => {
      db.all(
        `
        SELECT 
          u.username,
          u.email,
          u.phone,
          s.expires_at,
          p.name as plan_name,
          p.speed_limit,
          p.data_limit_mb,
          p.time_limit_hours
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        JOIN plans p ON s.plan_id = p.id
        WHERE s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
      `,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Format response for MikroTik
    const users = activeUsers.map((user) => ({
      username: user.username,
      password: user.username, // or generate from phone/email
      profile: user.plan_name.replace(/\s+/g, "-").toLowerCase(),
      comment: `${user.email || user.phone} - Expires: ${
        user.expires_at || "Never"
      }`,
      // Optional rate limiting
      rate_limit: user.speed_limit
        ? `${user.speed_limit}M/${user.speed_limit}M`
        : null,
      uptime_limit: user.time_limit_hours ? `${user.time_limit_hours}h` : null,
    }));

    console.log(`📡 MikroTik sync: ${users.length} active users`);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      users: users,
    });
  } catch (error) {
    console.error("❌ Sync error:", error);
    res.status(500).json({
      success: false,
      error: "Sync failed",
    });
  }
});

// POST endpoint to report session events from MikroTik
app.post("/api/mikrotik/event", async (req, res) => {
  try {
    const { username, event, bytes_in, bytes_out, session_time } = req.body;

    console.log(`📊 Event from MikroTik: ${event} - ${username}`);

    // Log the event (optional - for analytics)
    if (event === "logout" || event === "disconnect") {
      // Update usage statistics in your database
      db.run(
        `
        INSERT INTO usage_logs (username, bytes_in, bytes_out, session_time, logged_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
        [username, bytes_in || 0, bytes_out || 0, session_time || 0]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Event error:", error);
    res.status(500).json({ success: false });
  }
});

// Remove MikroTik connection code from voucher redemption
// Old code to DELETE:
/*
await connectToMikroTik();
const api = await mikrotik.connect(...);
*/

// New redemption code - just mark as active
app.post("/api/vouchers/redeem", async (req, res) => {
  try {
    const { code, username, phone, email } = req.body;

    // ... existing validation code ...

    // Create user and subscription
    const result = db.run(
      `
      INSERT INTO users (username, email, phone, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `,
      [username, email, phone]
    );

    const userId = result.lastID;

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + voucher.duration_days);

    // Create subscription
    db.run(
      `
      INSERT INTO subscriptions (user_id, plan_id, status, expires_at, created_at)
      VALUES (?, ?, 'active', ?, datetime('now'))
    `,
      [userId, voucher.plan_id, expiresAt.toISOString()]
    );

    // Mark voucher as used
    db.run(
      `
      UPDATE vouchers 
      SET status = 'used', used_by = ?, used_at = datetime('now')
      WHERE id = ?
    `,
      [userId, voucher.id]
    );

    console.log(`✅ Voucher redeemed: ${code} - User: ${username}`);
    console.log(`⏰ MikroTik will sync within 5 minutes`);

    res.json({
      success: true,
      message: "Voucher redeemed! You will be connected within 5 minutes.",
      username: username,
      expires_at: expiresAt,
    });
  } catch (error) {
    console.error("❌ Redeem error:", error);
    res.status(500).json({ error: "Redemption failed" });
  }
});
