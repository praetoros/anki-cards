import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readImageInfo } from "./image-header.ts";
import { ImageSet } from "./images.ts";
import { runProcess, withTempDir } from "./tools.ts";
import type { ExtractedUnit, ExtractionResult, ExtractOptions } from "./types.ts";

export const MIN_FRAME_INTERVAL_SEC = 10;
export const MAX_FRAMES = 60;

interface Probe {
  durationSec?: number;
  hasVideo: boolean;
}

/** Reads duration and stream types from `ffmpeg -i`, which prints them to stderr. */
export function parseFfmpegProbe(stderr: string): Probe {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const durationSec = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : undefined;
  const hasVideo = stderr
    .split("\n")
    .some((line) => /Stream #\S+.*: Video:/.test(line) && !line.includes("(attached pic)"));
  return { ...(durationSec !== undefined ? { durationSec } : {}), hasVideo };
}

/** Frame spacing that keeps a video within MAX_FRAMES. */
export function frameInterval(durationSec: number | undefined): number {
  if (durationSec === undefined) return MIN_FRAME_INTERVAL_SEC;
  return Math.max(MIN_FRAME_INTERVAL_SEC, durationSec / MAX_FRAMES);
}

/** Frame timestamps in seconds; just the first frame when the duration is unknown. */
export function frameTimes(durationSec: number | undefined, interval: number): number[] {
  if (durationSec === undefined) return [0];
  const times: number[] = [];
  for (let i = 0; i < MAX_FRAMES && i * interval < durationSec; i++) {
    times.push(Math.round(i * interval * 1000) / 1000);
  }
  return times.length > 0 ? times : [0];
}

export async function extractMedia(
  fileName: string,
  bytes: Uint8Array,
  fileType: "video" | "audio",
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const unit: ExtractedUnit = {
    unitType: "media",
    location: { label: fileName },
    text: "",
    textBlocks: [],
    imageKeys: [],
  };
  const result: ExtractionResult = {
    fileType,
    pageCount: 1,
    units: [unit],
    images: [],
    limitations: ["speech is not transcribed"],
  };
  const ffmpeg = options.ffmpegPath;
  if (!ffmpeg) {
    result.limitations.push(
      `${fileType} not probed: ffmpeg not installed (no duration${fileType === "video" ? " or frames" : ""})`,
    );
    return result;
  }

  return withTempDir(options.tempDir, async (dir) => {
    const input = join(dir, `source${extname(fileName).toLowerCase() || ".bin"}`);
    await writeFile(input, bytes);
    const probe = parseFfmpegProbe(
      (await runProcess(ffmpeg, ["-hide_banner", "-i", input], 60_000)).stderr,
    );
    if (probe.durationSec !== undefined) unit.durationSec = probe.durationSec;
    else result.limitations.push("duration unknown: ffmpeg reported none");
    if (fileType === "audio") return result;
    if (!probe.hasVideo) {
      result.limitations.push("no video stream found; no frames extracted");
      return result;
    }

    const interval = frameInterval(probe.durationSec);
    const times = frameTimes(probe.durationSec, interval);
    if (probe.durationSec === undefined) result.limitations.push("only the first frame was taken");
    const imageSet = new ImageSet();
    const failures: string[] = [];
    for (const timeSec of times) {
      const output = join(dir, `frame-${timeSec}.jpg`);
      // -ss before -i seeks the input, so only the frames near each timestamp are decoded.
      const run = await runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(timeSec),
          "-i",
          input,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          output,
        ],
        120_000,
      );
      const data = await readFile(output).then(
        (buffer) => new Uint8Array(buffer),
        () => undefined,
      );
      if (!data) {
        failures.push(`${timeSec}s (exit ${run.code}): ${run.stderr.trim().slice(0, 200)}`);
        continue;
      }
      const info = readImageInfo(data);
      const { image } = imageSet.add({
        key: `frame${imageSet.images.length + 1}`,
        kind: "frame",
        mime: "image/jpeg",
        width: info?.width ?? 0,
        height: info?.height ?? 0,
        data,
        location: { timeSec },
        provenance: { intervalSec: interval, timeSec },
      });
      unit.imageKeys.push(image.key);
    }
    if (failures.length > 0)
      result.limitations.push(`ffmpeg extracted no frame at ${failures.join("; ")}`);
    result.images = imageSet.images;
    return result;
  });
}
