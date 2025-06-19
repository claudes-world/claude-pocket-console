/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,
  
  // Transpile packages from the monorepo
  transpilePackages: ["@cpc/ui", "@cpc/lib"],
  
  // Output standalone for better deployment
  output: "standalone",
}

module.exports = nextConfig