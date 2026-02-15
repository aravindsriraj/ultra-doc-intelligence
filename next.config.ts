import type { NextConfig } from "next";

const workspaceRoot = process.cwd();

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
