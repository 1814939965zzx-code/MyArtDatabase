import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vinext currently applies this multipart limit before API route matching.
      // Keep a little headroom over the product's 50MB per-file limit.
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
