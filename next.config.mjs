const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isPagesBuild =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.NODE_ENV === "production" &&
  repository;
const basePath = isPagesBuild ? `/${repository}` : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  // CI's next dev indicator overlaps the mobile nav; error reporting stays on.
  devIndicators: process.env.CI === "true" ? false : undefined,
  images: { unoptimized: true },
  typescript: { tsconfigPath: "./tsconfig.next.json" },
};

export default nextConfig;
