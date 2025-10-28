import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const {
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  MPESA_BASE_URL,
  MPESA_CALLBACK_URL,
} = process.env;

// Get access token
export const getAccessToken = async () => {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
  const res = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return res.data.access_token;
};

// Send STK Push
export const initiateStkPush = async ({ amount, phone, accountRef }) => {
  const token = await getAccessToken();

  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14); // Format: YYYYMMDDHHMMSS

  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString("base64");

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone.startsWith("254") ? phone : `254${phone.slice(-9)}`,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: phone.startsWith("254") ? phone : `254${phone.slice(-9)}`,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: accountRef || "WiFi Subscription",
    TransactionDesc: "WiFi Subscription Payment",
  };

  const res = await axios.post(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return res.data;
};
