import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The novnc npm package ships a broken static import in
// core/input/keyboard.js → ../../app/ui.js which does not exist in
// the published package.  We stub it out so the bundler can resolve it.
const novncStub = path.join(__dirname, 'src', 'stubs', 'novnc-ui.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  turbopack: {
    resolveAlias: {
      '../../app/ui.js': './src/stubs/novnc-ui.js',
    },
  },
  webpack: (config) => {
    config.resolve.alias['../../app/ui.js'] = novncStub;
    return config;
  },
};

export default nextConfig;
