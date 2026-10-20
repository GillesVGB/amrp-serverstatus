import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  experimental: { cpus: 1 },
};

export default nextConfig;
