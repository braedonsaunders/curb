import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  async rewrites() {
    return [
      {
        source: '/sites/:path*',
        destination: '/api/sites/:path*',
      },
    ];
  },
};

export default nextConfig;
