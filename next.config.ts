import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // `public/img/` の画像は名前に版の番号を付け、長く保存させる。
        // 画像を替えるときは名前の番号を上げる（DD-09 2.1、CR-017）。
        source: "/img/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
