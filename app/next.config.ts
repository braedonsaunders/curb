import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['better-sqlite3', 'playwright'],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/sites/:siteSlug/admin',
          destination: '/site-admin/:siteSlug',
        },
        {
          source: '/sites/:siteSlug/admin/:path*',
          destination: '/site-admin/:siteSlug/:path*',
        },
      ],
      afterFiles: [
        {
          source: '/sites/:path+',
          destination: '/api/sites/:path*',
        },
      ],
    };
  },
};

export default nextConfig;
