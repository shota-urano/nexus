import { defineConfig } from "vitest/config";

// 自動のテスト（DD-10、ADR-022）。画面の部品のテストはファイルの先頭で jsdom を指定する。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    reporters: ["default", "junit"],
    outputFile: { junit: "reports/junit.xml" },
  },
});
