import { defineConfig } from "vite";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: { target: "esnext" },
  optimizeDeps: {
    exclude: ["kokoro-js", "@huggingface/transformers", "phonemizer"],
  },
  server: { headers: isolation },
  preview: { headers: isolation },
});
