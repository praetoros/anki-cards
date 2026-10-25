import type { OcclusionShape } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { useRef, useState } from "react";
import { useFetcher } from "react-router";

type Rect = Extract<OcclusionShape, { shape: "rect" }>;

/** Draw, select and delete rectangular masks over an image. Coordinates are 0–1 fractions. */
export function MaskEditor({
  cardId,
  mediaId,
  initial,
}: {
  cardId: string;
  mediaId: string;
  initial: OcclusionShape[];
}) {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  const [shapes, setShapes] = useState<OcclusionShape[]>(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const toRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    shape: "rect",
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        className="relative w-full max-w-xl cursor-crosshair touch-none select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset["mask"]) return;
          start.current = point(e);
          setSelected(null);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current) setDraft(toRect(start.current, point(e)));
        }}
        onPointerUp={(e) => {
          if (start.current) {
            const rect = toRect(start.current, point(e));
            if (rect.width > 0.01 && rect.height > 0.01) {
              setShapes((s) => [...s, { ...rect, ordinal: s.length + 1 }]);
            }
          }
          start.current = null;
          setDraft(null);
        }}
      >
        <img src={`/media/${mediaId}`} alt="" className="w-full rounded border" draggable={false} />
        {[...shapes, ...(draft ? [draft] : [])].map((s, i) => {
          const rect =
            s.shape === "rect"
              ? s
              : s.shape === "ellipse"
                ? { left: s.left, top: s.top, width: s.rx * 2, height: s.ry * 2 }
                : {
                    left: Math.min(...s.points.map((p) => p.x)),
                    top: Math.min(...s.points.map((p) => p.y)),
                    width:
                      Math.max(...s.points.map((p) => p.x)) - Math.min(...s.points.map((p) => p.x)),
                    height:
                      Math.max(...s.points.map((p) => p.y)) - Math.min(...s.points.map((p) => p.y)),
                  };
          return (
            <div
              key={i}
              data-mask="1"
              onPointerDown={() => setSelected(i)}
              className={`absolute border-2 ${
                selected === i
                  ? "border-destructive bg-destructive/40"
                  : "border-amber-600 bg-amber-400/60"
              } ${s.shape === "ellipse" ? "rounded-full" : ""}`}
              style={{
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
              title={s.label}
            >
              <span data-mask="1" className="absolute -top-4 left-0 text-[10px] font-semibold">
                {s.ordinal ?? i + 1}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Drag on the image to add a mask.</span>
        <Button
          size="xs"
          variant="outline"
          disabled={selected === null}
          onClick={() => {
            setShapes((s) =>
              s.filter((_, i) => i !== selected).map((m, i) => ({ ...m, ordinal: i + 1 })),
            );
            setSelected(null);
          }}
        >
          Delete selected
        </Button>
        <fetcher.Form method="post">
          <input type="hidden" name="cardId" value={cardId} />
          <input type="hidden" name="mediaId" value={mediaId} />
          <input type="hidden" name="shapes" value={JSON.stringify(shapes)} />
          <Button type="submit" size="xs" name="intent" value="save-masks">
            Save masks
          </Button>
        </fetcher.Form>
        {fetcher.data?.error && (
          <span className="text-xs text-destructive">{fetcher.data.error}</span>
        )}
        {fetcher.data?.message && (
          <span className="text-xs text-muted-foreground">{fetcher.data.message}</span>
        )}
      </div>
    </div>
  );
}
