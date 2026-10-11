import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare's free plan has no Next.js image optimiser; the logos are already sized PNGs.
  images: { unoptimized: true },
};

export default nextConfig;

// Lets `next dev` use Cloudflare bindings locally (no effect on the production build).
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev()).catch(() => {});
