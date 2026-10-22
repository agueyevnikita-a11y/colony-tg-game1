import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: process.env.NEXT_PUBLIC_LOCAL_DEV === 'true' ? false : undefined,
};

export default nextConfig;
