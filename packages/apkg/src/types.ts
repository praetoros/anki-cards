export interface NoteTypeField {
  name: string;
  /** Anki field tag, e.g. the Image Occlusion field role (0–4). */
  tag?: number;
  preventDeletion?: boolean;
}

export interface NoteTypeTemplate {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface NoteTypeDef {
  id: number;
  name: string;
  kind: "standard" | "cloze";
  fields: NoteTypeField[];
  templates: NoteTypeTemplate[];
  css: string;
  sortField?: number;
  /** Anki's `OriginalStockKind`; 6 marks an Image Occlusion note type. */
  originalStockKind?: number;
}

/** `A::B::C` names create the parent decks too. */
export interface DeckDef {
  id: number;
  name: string;
}

export interface NoteDef {
  guid: string;
  noteTypeId: number;
  deckId: number;
  fields: string[];
  tags: string[];
}

export interface MediaDef {
  name: string;
  data: Uint8Array;
}

export interface ApkgInput {
  noteTypes: NoteTypeDef[];
  decks: DeckDef[];
  notes: NoteDef[];
  media: MediaDef[];
}
