import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 層ごとのフォルダ（DD-01 1章、2章）。道はリポジトリの根からの glob で書く。
// `**` は0個の段を含まないので、フォルダの直下のファイルは `*` で別に書く。
const LAYERS = {
  // 画面（PWA）の側（DD-01 1.1）
  screen: ["src/app/[(]screens[)]/**", "src/screens/**"], // 画面層 M01〜M06
  parts: ["src/ui/**"], // 部品層 M07、M08
  client: ["src/client/**"], // 通信層 M09
  contracts: ["src/contracts/**"], // 共有の型層 M10
  // Web サーバ、AI Runner、定期ジョブ、管理のコマンドの側（DD-01 1.2）
  entry: [
    "src/app/api/**", // M11
    "src/runner/*", // M24
    "src/runner/!(purposes|ai-provider)/**",
    "src/jobs/*", // M27
    "src/jobs/!(backup|purge|lock)/**",
    "src/cli/**", // M30
  ],
  business: [
    "src/server/{auth,ingest,kinds,contents,chat,home,ai-jobs}/**", // M12〜M20
    "src/runner/purposes/**", // M25
    "src/jobs/{backup,purge,lock}/**", // M28、M29、M31
  ],
  data: ["src/server/{db,repositories}/**"], // M21、M22
  external: ["src/runner/ai-provider/**"], // M26
  common: ["src/server/shared/**"], // M23
};

// 入口層の4つのモジュール。入口層どうしは呼ばない（DD-01 1.2）。
const ENTRY_MODULES = [
  ["src/app/api/**"],
  ["src/runner/*", "src/runner/!(purposes|ai-provider)/**"],
  ["src/jobs/*", "src/jobs/!(backup|purge|lock)/**"],
  ["src/cli/**"],
];

// 画面の全ての層から読み込まないフォルダ（DD-01 1.1。BD-10 4章 秘密情報の管理）。
const SERVER_SIDE = [
  "src/server/**",
  "src/runner/**",
  "src/jobs/**",
  "src/cli/**",
  "src/app/api/**",
];
const SCREEN_SIDE = [...LAYERS.screen, ...LAYERS.parts, ...LAYERS.client];

const of = (...names) => names.flatMap((name) => LAYERS[name]);

const layerZones = [
  // DD-01 1.1 画面（PWA）
  {
    target: LAYERS.screen,
    from: SERVER_SIDE,
    message: "画面層は部品層、通信層、共有の型層だけを読み込む（DD-01 1.1）。",
  },
  {
    target: LAYERS.parts,
    from: [...SERVER_SIDE, ...of("screen", "client")],
    message: "部品層は共有の型層だけを読み込む（DD-01 1.1）。",
  },
  {
    target: ["src/ui/*", "src/ui/!(kinds)/**"],
    from: ["src/ui/kinds/**"],
    message:
      "共通部品（M07）から種類ごとの表示部品（M08）を呼ばない（DD-01 1.1）。",
  },
  {
    target: LAYERS.client,
    from: [...SERVER_SIDE, ...of("screen", "parts")],
    message: "通信層は共有の型層だけを読み込む（DD-01 1.1）。",
  },
  {
    target: LAYERS.contracts,
    from: [...SERVER_SIDE, ...SCREEN_SIDE],
    message: "共有の型層はほかのモジュールを呼ばない（DD-01 1.2）。",
  },
  // DD-01 1.2 Web サーバ、AI Runner、定期ジョブ、管理のコマンド
  {
    target: LAYERS.entry,
    from: [...SCREEN_SIDE, ...of("data", "external")],
    message: "入口層は業務層、共通層、共有の型層だけを読み込む（DD-01 1.2）。",
  },
  ...ENTRY_MODULES.map((module) => ({
    target: module,
    from: ENTRY_MODULES.filter((other) => other !== module).flat(),
    message: "入口層どうしは呼ばない（DD-01 1.2）。",
  })),
  {
    target: LAYERS.business,
    from: [...SCREEN_SIDE, ...of("contracts", "entry")],
    message: "業務層は業務層、データ層、共通層だけを読み込む（DD-01 1.2）。",
  },
  {
    target: LAYERS.business.filter((dir) => dir !== "src/runner/purposes/**"),
    from: LAYERS.external,
    message: "外部の口層（M26）を呼ぶのは M25 だけである（DD-01 1.2）。",
  },
  {
    target: LAYERS.data,
    from: [...SCREEN_SIDE, ...of("contracts", "entry", "business", "external")],
    message: "データ層は共通層だけを読み込む（DD-01 1.2）。",
  },
  {
    target: ["src/server/db/**"],
    from: ["src/server/repositories/**"],
    message:
      "データ層の中では M22 から M21 を呼ぶ。逆は呼ばない（DD-01 1.2）。",
  },
  {
    target: LAYERS.external,
    from: [...SCREEN_SIDE, ...of("contracts", "entry", "business", "data")],
    message: "外部の口層は共通層だけを読み込む（DD-01 1.2）。",
  },
  {
    target: LAYERS.common,
    from: [
      ...SCREEN_SIDE,
      ...of("contracts", "entry", "business", "data", "external"),
    ],
    message: "共通層はほかのモジュールを呼ばない（DD-01 1.2）。",
  },
];

// 子のプロセスを起動する部品。M26 の外から読み込まない（DD-01 1.3、3章。NFR-016）。
const CHILD_PROCESS_MESSAGE =
  "子のプロセスを起動するのは外部の口層（src/runner/ai-provider）だけである（DD-01 1.3）。";

// Next.js の標準の設定（X-07 3章）に、層の規則（DD-01 1.3）と空の catch の禁止（DD-06 1章）を足す。
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        { basePath: import.meta.dirname, zones: layerZones },
      ],
      "import/no-cycle": "error",
    },
  },
  {
    ignores: ["src/runner/ai-provider/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:child_process", message: CHILD_PROCESS_MESSAGE },
            { name: "child_process", message: CHILD_PROCESS_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "reports/**",
    ".data/**",
    "prototype/**",
    "NEXUS_implementation_handoff/**",
  ]),
]);
