import type { NextConfig } from "next";

const defaultDistDir =
  process.env.NODE_ENV === "development"
    ? "node_modules/.cache/next-dev-runtime"
    : "node_modules/.cache/next-build-runtime";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || defaultDistDir,
};

export default nextConfig;
