import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        process: true,
      },
    }),
  ],
  // The browser console imports shared logic from core/.
  server: {
    fs: {
      allow: ["."],
    },
  },
});
