import { renderCard } from "@anki-cards/apkg/preview";
import {
  listCards,
  masksForCards,
  NOTE_TYPE_FOR,
  noteFields,
  type TCardS,
  type TDb,
} from "@anki-cards/core";

export interface CardPreview {
  ord: number;
  front: string;
  back: string;
}

function ordinals(card: TCardS, fields: string[]): number[] {
  const type = NOTE_TYPE_FOR[card.cardType];
  if (type.kind === "standard") return type.templates.map((_, i) => i);
  const text = fields.join(" ");
  const nums = [...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]) - 1);
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, 6);
}

/** Cards of a topic with HTML previews rendered from the same note types as the export. */
export async function cardsWithPreviews(db: TDb, topicId: string) {
  const cards = await listCards(db, topicId);
  const masks = await masksForCards(
    db,
    cards.map((c) => c.id),
  );
  const out = [];
  for (const card of cards) {
    const type = NOTE_TYPE_FOR[card.cardType];
    const fields = await noteFields(db, card, (id) => `/media/${id}`);
    const previews: CardPreview[] = [];
    for (const ord of ordinals(card, fields)) {
      try {
        previews.push({
          ord,
          front: renderCard(type, fields, ord, "front"),
          back: renderCard(type, fields, ord, "back"),
        });
      } catch {
        // a card without a renderable side (e.g. no masks yet) has no preview
      }
    }
    out.push({
      card,
      css: type.css,
      previews,
      masks: masks.find((m) => m.cardId === card.id)?.shapes ?? [],
    });
  }
  return out;
}
