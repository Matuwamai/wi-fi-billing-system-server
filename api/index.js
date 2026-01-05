import app from "./app.js";

const PORT = process.env.PORT || 5005;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});

// Start background job
