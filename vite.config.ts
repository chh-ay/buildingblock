import { defineConfig } from "vite";

export default defineConfig({
   // Project-pages deploys set BASE_PATH=/<repo>/ in CI; local dev serves from root.
   base: process.env.BASE_PATH || "/",
   build: { target: "esnext", chunkSizeWarningLimit: 1500 },
   worker: { format: "es" },
});
