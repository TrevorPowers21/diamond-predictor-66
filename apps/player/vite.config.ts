import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Standalone app — own root, own build. Deployed as a separate Vercel
// project (Root Directory: apps/player) at player.rstriq.com, distinct
// from the coach/scout app's Vercel project. No monorepo/workspace tooling
// ties this to the root package.json.
export default defineConfig({
  server: {
    port: 5174,
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
