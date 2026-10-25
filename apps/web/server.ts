import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createRequestListener } from "@react-router/node";

const host = "127.0.0.1";
const port = Number(process.env.ANKI_CARDS_PORT ?? 4317);
const clientDir = fileURLToPath(new URL("./build/client", import.meta.url));
process.env.ANKI_CARDS_ROOT ??= fileURLToPath(new URL("../../", import.meta.url));

const mimeTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const handleRequest = createRequestListener({
  // @ts-expect-error The build only exists after `react-router build`.
  build: () => import("./build/server/index.js"),
});

async function serveStatic(pathname: string): Promise<{ path: string; size: number } | undefined> {
  const path = normalize(join(clientDir, decodeURIComponent(pathname)));
  if (!path.startsWith(clientDir + sep)) return undefined;
  try {
    const info = await stat(path);
    return info.isFile() ? { path, size: info.size } : undefined;
  } catch {
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${host}`).pathname;
  if (req.method === "GET" && pathname !== "/") {
    const file = await serveStatic(pathname);
    if (file) {
      res.writeHead(200, {
        "Content-Type": mimeTypes[extname(file.path)] ?? "application/octet-stream",
        "Content-Length": file.size,
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      createReadStream(file.path).pipe(res);
      return;
    }
  }
  handleRequest(req, res);
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  console.log(`Anki Cards running at ${url}`);
  if (!process.env.ANKI_CARDS_NO_OPEN) openBrowser(url);
});

function openBrowser(url: string) {
  const command =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command[0] as string, command[1] as string[], { detached: true, stdio: "ignore" }).unref();
}
