import MikroNode from "mikronode-ng";

const device = new MikroNode("192.168.88.1", "admin", "", {
  port: 8728,
});

device
  .connect()
  .then((client) => {
    console.log("🔥 Connected to MikroTik API");

    client.close(); // close after testing
  })
  .catch((err) => {
    console.error("❌ Connection failed:", err);
  });
