import app from "./app.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
import subscriptionExpiryJob from "./jobs/subscriptionExpiryJob.js";

// Start background job
subscriptionExpiryJob();
