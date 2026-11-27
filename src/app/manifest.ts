import type { MetadataRoute } from "next";

// PWA の manifest（DD-01 M01、BD-01 NFR-007）。`/manifest.webmanifest` で配る。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXUS",
    short_name: "NEXUS",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ja",
    // アイコンは public/img/icon/app-icon_001.png（1024×1024）を縮めたもの。
    icons: [
      {
        src: "/img/icon/app-icon-192_001.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/img/icon/app-icon-512_001.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
