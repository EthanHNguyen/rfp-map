import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isGitHubPages ? "/rfp-map" : undefined,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
