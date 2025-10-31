import app from "./app.js";
import subscriptionExpiryJob from "./jobs/subscriptionExpirery.js";
import "./jobs/subscriptionMonitor.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Start background job
subscriptionExpiryJob();
