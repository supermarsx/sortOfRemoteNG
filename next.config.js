/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Handle Node.js built-in modules
    config.resolve.alias = {
      ...config.resolve.alias,
      'node:net': false,
      'node:tls': false,
      'node:crypto': false,
      'node:stream': false,
      'node:url': false,
      'node:zlib': false,
      'node:http': false,
      'node:https': false,
      'node:assert': false,
      'node:os': false,
      'node:path': false,
      'node:fs': false,
    };

    // Exclude problematic modules from client-side bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }

    // Add support for node: scheme
    config.resolve.conditionNames = ['node'];

    // Exclude SSH-related modules from webpack bundling
    config.externals = config.externals || [];
    config.externals.push({
      'ssh2': 'ssh2',
      'node-ssh': 'node-ssh',
      'simple-ssh': 'simple-ssh',
      'cpu-features': 'cpu-features',
      'node:net': 'node:net',
      'node:tls': 'node:tls',
      'node:crypto': 'node:crypto',
      'node:stream': 'node:stream',
      'node:url': 'node:url',
      'node:zlib': 'node:zlib',
      'node:http': 'node:http',
      'node:https': 'node:https',
      'node:assert': 'node:assert',
      'node:os': 'node:os',
      'node:path': 'node:path',
      'node:fs': 'node:fs',
    });

    return config;
  },
};

export default nextConfig;