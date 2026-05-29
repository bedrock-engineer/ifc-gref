import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import package_ from "./package.json" with { type: "json" };

// https://vite.dev/config/
export default defineConfig({
  // Served at the root of the geo.buildingsmart.nl custom domain.
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(package_.version),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  worker: {
    format: "es",
  },
});
