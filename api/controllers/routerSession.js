import MikroNode from "mikronode-ng";

const routerConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASS,
  apiPort: process.env.MIKROTIK_API_PORT,
};

export const getMikroTikConnection = () => {
  return MikroNode.getConnection(
    routerConfig.host,
    routerConfig.user,
    routerConfig.password,
    {
      port: routerConfig.apiPort || 8728,
    }
  );
};
