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
  };
}
