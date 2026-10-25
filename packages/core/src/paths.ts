import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The cloned repository. Bundled builds can't derive it from module URLs, so the server sets it. */
export const repoRoot =
  process.env.ANKI_CARDS_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));

export interface AppPaths {
  data: string;
  db: string;
  sources: string;
  media: string;
  exports: string;
  backups: string;
}

export function resolvePaths(
  dataDir = process.env.ANKI_CARDS_DATA ?? join(repoRoot, "data"),
): AppPaths {
  const data = resolve(dataDir);
  const paths: AppPaths = {
    data,
    db: join(data, "anki-cards.db"),
    sources: join(data, "sources"),
    media: join(data, "media"),
    exports: join(data, "exports"),
    backups: join(data, "backups"),
  };
  for (const dir of [paths.data, paths.sources, paths.media, paths.exports]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
