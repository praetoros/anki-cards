import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const port = Number(process.env.ANKI_CARDS_PORT ?? 4317);

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
  ssr: {
    external: ["mupdf"],
  },
});
