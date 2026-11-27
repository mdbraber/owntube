import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests render TSX (tsconfig keeps JSX for Next to compile).
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [path.resolve(__dirname, "./src/test/setup.ts")],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
