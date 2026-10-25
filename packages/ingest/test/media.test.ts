import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { detectTools, extractSource, readImageInfo } from "../src/index.ts";
import { frameInterval, frameTimes, parseFfmpegProbe } from "../src/media.ts";
import { runProcess } from "../src/tools.ts";

const tools = await detectTools();
const ffmpeg = tools.ffmpeg?.path;

describe("media helpers", () => {
  it("parses duration and video streams from ffmpeg -i output", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':",
      "  Duration: 01:02:03.50, start: 0.000000, bitrate: 25 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 160x120, 10 fps",
    ].join("\n");
    expect(parseFfmpegProbe(stderr)).toEqual({ durationSec: 3723.5, hasVideo: true });
    const coverArt = "  Duration: 00:00:02.00\n  Stream #0:1: Video: mjpeg, 300x300 (attached pic)";
    expect(parseFfmpegProbe(coverArt)).toEqual({ durationSec: 2, hasVideo: false });
  });

  it("spaces frames at least 10 s apart and at most 60 per video", () => {
    expect(frameInterval(30)).toBe(10);
    expect(frameInterval(3600)).toBe(60);
    expect(frameInterval(undefined)).toBe(10);
    expect(frameTimes(25, 10)).toEqual([0, 10, 20]);
    expect(frameTimes(7200, frameInterval(7200))).toHaveLength(60);
    expect(frameTimes(undefined, 10)).toEqual([0]);
  });

  it("records a limitation when ffmpeg is not available", async () => {
    const result = await extractSource(
      "clip.mp4",
      new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    );
    expect(result.fileType).toBe("video");
    expect(result.units.map((u) => u.unitType)).toEqual(["media"]);
    expect(result.limitations).toContain(
      "video not probed: ffmpeg not installed (no duration or frames)",
    );
  });
});

describe.skipIf(!ffmpeg)("media via ffmpeg", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ingest-media-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function generate(name: string, args: string[]): Promise<Uint8Array> {
    const out = join(dir, name);
    await runProcess(
      ffmpeg ?? "",
      ["-hide_banner", "-loglevel", "error", "-y", ...args, out],
      60_000,
    );
    return new Uint8Array(await readFile(out));
  }

  it("reports the ffmpeg version", () => {
    expect(tools.ffmpeg?.version).toMatch(/\d/);
  });

  it("probes duration and grabs one frame every 10 s", async () => {
    const video = await generate("clip.mp4", [
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=12:size=160x120:rate=10",
      "-pix_fmt",
      "yuv420p",
    ]);
    const result = await extractSource("clip.mp4", video, { ffmpegPath: ffmpeg, tempDir: dir });
    expect(result.fileType).toBe("video");
    const [media] = result.units;
    expect(media?.unitType).toBe("media");
    expect(media?.durationSec).toBeCloseTo(12, 0);
    expect(result.images.map((i) => [i.key, i.kind, i.location.timeSec])).toEqual([
      ["frame1", "frame", 0],
      ["frame2", "frame", 10],
    ]);
    expect(media?.imageKeys).toEqual(["frame1", "frame2"]);
    expect(readImageInfo(result.images[0]?.data ?? new Uint8Array())).toEqual({
      mime: "image/jpeg",
      width: 160,
      height: 120,
    });
  });

  it("probes audio duration without frames", async () => {
    const audio = await generate("tone.wav", [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
    ]);
    const result = await extractSource("tone.wav", audio, { ffmpegPath: ffmpeg, tempDir: dir });
    expect(result.fileType).toBe("audio");
    expect(result.units[0]?.durationSec).toBeCloseTo(2, 1);
    expect(result.images).toEqual([]);
  });
});

describe("detectTools", () => {
  it("returns a path for each tool it finds", () => {
    for (const tool of [tools.libreOffice, tools.ffmpeg]) {
      if (tool) expect(tool.path.length).toBeGreaterThan(0);
    }
  });
});
