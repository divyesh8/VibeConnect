import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // ESLint is run explicitly by `npm run lint`; keeping it outside the build
  // avoids Next 15's legacy ESLint runner conflicting with the flat config.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
