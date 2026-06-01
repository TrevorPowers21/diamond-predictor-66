import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-tooltip", "@radix-ui/react-dropdown-menu"],
          "page-admin": ["./src/pages/AdminDashboard.tsx"],
          "page-transfer-portal": ["./src/pages/TransferPortal.tsx"],
          "page-returning": ["./src/pages/ReturningPlayers.tsx"],
          "page-team-builder": ["./src/pages/TeamBuilder.tsx"],
          "pdf-generator": ["./src/lib/pdfGenerator.ts"],
        },
      },
    },
  },
}));
