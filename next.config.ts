import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra and the Postgres driver must run as plain Node.js modules on the server.
  serverExternalPackages: ["@mastra/*", "pg"],
};

export default nextConfig;
