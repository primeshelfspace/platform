/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The shared packages ship compiled CommonJS; transpiling them here keeps
  // the module graph consistent with the app's ESM output.
  transpilePackages: ['@fenwick/shared', '@fenwick/ui'],

  // Every Brand Settings save posts the logo file through a server action
  // (see saveLogo in brand-settings/actions.ts), and Next's default server
  // action body cap is 1MB — well under the API's own 5MB logo limit
  // (MAX_LOGO_BYTES in apps/api/src/common/logo-upload.ts), so any real
  // photo over ~1MB crashed the whole form with an unhandled "Body exceeded
  // 1 MB limit" error before the request ever reached the API. Raised past
  // the API's cap so that limit is the one that actually applies.
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },

  // The admin app's CSP is standard rather than strict. The payment app's is
  // not — see apps/payment/next.config.mjs and TDD-001 §3.3. A third-party
  // script here is a product decision; there it is a compliance breach.
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
