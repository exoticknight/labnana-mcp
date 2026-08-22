import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  root: "ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./ui/image-result.html", import.meta.url)),
    },
  },
});
