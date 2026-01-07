import dotenv from "dotenv";
dotenv.config();

console.log("⚠️ WARNING: Direct MikroTik connection is deprecated");
console.log("📡 MikroTik now syncs from cloud via scheduled script");
console.log("🔗 See routes/mikrotik.js for new sync endpoints");

// Keep this for backward compatibility if needed
export const connectMikroTik = async () => {
  throw new Error(
    "Direct MikroTik connection is deprecated. Use cloud sync instead. " +
      "MikroTik pulls data from /api/mikrotik/sync-simple every 5 minutes."
  );
};

export default {
  connectMikroTik,
};
