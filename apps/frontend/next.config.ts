import type { NextConfig } from 'next';

// An isolated local acceptance server must not share Next's build cache with
// the regular development server. Normal dev/build keep their existing path.
const acceptanceDistDir = process.env.CRM_PREVIEW_DIST_DIR;
if (acceptanceDistDir && !/^\.next-acl-preview-\d+$/.test(acceptanceDistDir)) {
  throw new Error('CRM_PREVIEW_DIST_DIR must be a dedicated .next-acl-preview-<pid> directory');
}
const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(acceptanceDistDir ? { distDir: acceptanceDistDir } : {}),
};

export default nextConfig;
