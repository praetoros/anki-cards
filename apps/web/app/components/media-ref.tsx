import { Fragment, useState } from "react";
import { useParams } from "react-router";

import { ImagePreview } from "./image-preview";

/** Matches display ids (`MED-003`) and long ids (`med_01m5…`) of media assets. */
const MEDIA_ID = /\b(MED-\d{3,}|med_[0-9a-z]{26})\b/g;

function mediaUrl(id: string, libraryId: string | undefined) {
  return id.startsWith("MED-") && libraryId
    ? `/media/${id}?library=${encodeURIComponent(libraryId)}`
    : `/media/${id}`;
}

/** A thumbnail of a media asset that opens the full image. Falls back to the id if missing. */
export function MediaRef({ id, size = "sm" }: { id: string; size?: "sm" | "md" }) {
  const { libraryId } = useParams();
  const [failed, setFailed] = useState(false);
  const url = mediaUrl(id, libraryId);
  if (failed) return <code className="text-xs">{id}</code>;
  return (
    <ImagePreview
      src={url}
      alt={id}
      onError={() => setFailed(true)}
      className="mx-0.5 inline-flex max-w-full flex-col items-start gap-0.5 align-top"
      imgClassName={`rounded border bg-white object-contain ${size === "md" ? "max-h-40" : "max-h-20"}`}
    >
      <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
    </ImagePreview>
  );
}

/** Text with every media reference shown as its image. */
export function MediaText({ text }: { text: string }) {
  const parts = text.split(MEDIA_ID);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <MediaRef key={i} id={part} /> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/** Any stored value (string, list, object) with its media references shown as images. */
export function MediaValue({
  value,
  max = 300,
  plain = false,
}: {
  value: unknown;
  max?: number;
  /** Show the text without images (for a row's own id fields). */
  plain?: boolean;
}) {
  if (value === undefined || value === null) return <>—</>;
  if (plain) return <>{typeof value === "string" ? value : JSON.stringify(value)}</>;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (
      <>
        {value.map((v, i) => (
          <Fragment key={v}>
            {i > 0 && ", "}
            <MediaText text={v} />
          </Fragment>
        ))}
      </>
    );
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const hasMedia = text.search(MEDIA_ID) >= 0;
  return <MediaText text={!hasMedia && text.length > max ? `${text.slice(0, max)}…` : text} />;
}
