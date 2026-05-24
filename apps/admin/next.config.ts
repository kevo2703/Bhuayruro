import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@huayruro/shared", "@huayruro/ui", "@huayruro/db"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
