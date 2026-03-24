import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 3000,
    proxy: {
      "/query": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
