export type UnitType =
  | "page"
  | "slide"
  | "text"
  | "table"
  | "figure"
  | "diagram"
  | "visual_component"
  | "media";

/** In page points, origin top-left. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextBlock {
  text: string;
  bbox: BBox;
}

export interface ExtractedImage {
  /** Unique within the result, e.g. "p3-img2", "p3-render", "slide4-media1". */
  key: string;
  kind: "embedded" | "render" | "frame";
  mime: string;
  width: number;
  height: number;
  sha256: string;
  data: Uint8Array;
  location: { page?: number; slide?: number; timeSec?: number };
  /** Placement on the page or slide when known. */
  bbox?: BBox;
  provenance: Record<string, string | number>;
}

export interface ExtractedUnit {
  unitType: UnitType;
  location: { page?: number; slide?: number; label?: string };
  text: string;
  /** Word or line positions, used later for Image Occlusion masks. */
  textBlocks: TextBlock[];
  /** Images belonging to this unit, render first if any. */
  imageKeys: string[];
  /** Page or slide size in points. */
  size?: { width: number; height: number };
  /** Media units only. */
  durationSec?: number;
}

export type FileType = "pdf" | "pptx" | "docx" | "markdown" | "text" | "image" | "video" | "audio";

export interface ExtractionResult {
  fileType: FileType;
  /** Pages or slides; 1 for single-unit files. */
  pageCount: number;
  units: ExtractedUnit[];
  images: ExtractedImage[];
  /** Human-readable notes on anything not extracted. */
  limitations: string[];
}

export interface ExtractOptions {
  /** Page and slide render resolution. Default 150. */
  renderDpi?: number;
  /** soffice executable, usually from `detectTools()`. Conversions are skipped when absent. */
  libreOfficePath?: string | null;
  /** ffmpeg executable, usually from `detectTools()`. Media probing is skipped when absent. */
  ffmpegPath?: string | null;
  /** Parent directory for temporary files. Default `os.tmpdir()`. */
  tempDir?: string;
}

export interface DetectedTool {
  path: string;
  version?: string;
}

export interface DetectedTools {
  libreOffice: DetectedTool | null;
  ffmpeg: DetectedTool | null;
}
