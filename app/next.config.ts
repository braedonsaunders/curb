import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3', 'playwright'],
  async rewrites() {
    return [
      {
        source: '/sites/:path+',
        destination: '/api/sites/:path*',
      },
    ];
  },
};

export default nextConfig;
