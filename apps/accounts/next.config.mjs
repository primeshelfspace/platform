/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Same build-slot scheme as the other web apps — see deploy/deploy.sh.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // The shared packages ship compiled CommonJS; transpiling them here keeps
  // the module graph consistent with the app's ESM output.
  transpilePackages: ['@platform/kernel', '@platform/platform-contracts', '@platform/ui'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
