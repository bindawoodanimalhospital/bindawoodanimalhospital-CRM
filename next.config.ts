import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare's free plan has no Next.js image optimiser; the logos are already sized PNGs.
  images: { unoptimized: true },
  // Medical records shared with owners by private link: never cached, indexed, or leaked in the Referer header.
  headers() {
    return Promise.resolve([{
      source: "/r/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }]);
  },
};

export default nextConfig;

// Lets `next dev` use Cloudflare bindings locally (no effect on the production build).
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev()).catch(() => {});
