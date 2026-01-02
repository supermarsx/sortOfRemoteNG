/** @type {import('next').NextConfig} */
const nextConfig = {
  // output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  serverExternalPackages: ['@tauri-apps/api'],
  generateBuildId: async () => {
    return 'build-' + Date.now()
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('@tauri-apps/api');
    }
    return config;
  },
};

export default nextConfig;