// Browser-safe entry: everything except the writer, which needs node:sqlite and node:crypto.

export { guidFor, stableNumericId } from "./ids.ts";
export {
  floatToDisplay,
  occlusionsToCloze,
  type EllipseMask,
  type OcclusionMask,
  type OcclusionsToClozeOptions,
  type Point,
  type PolygonMask,
  type RectMask,
} from "./image-occlusion.ts";
export {
  basic,
  basicReversed,
  CARD_CSS,
  cloze,
  IMAGE_OCCLUSION_STOCK_KIND,
  imageOcclusion,
  imageQuestion,
  noteTypes,
  type NoteTypeKey,
} from "./note-types.ts";
export { renderCard, type CardSide } from "./render.ts";
export type {
  ApkgInput,
  DeckDef,
  MediaDef,
  NoteDef,
  NoteTypeDef,
  NoteTypeField,
  NoteTypeTemplate,
} from "./types.ts";
