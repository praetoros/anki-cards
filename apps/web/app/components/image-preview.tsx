import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@anki-cards/ui/components/dialog";

/** The full-size image modal, opened by the caller. */
export function ImageModal({
  src,
  alt,
  title,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ImageModalContent src={src} alt={alt} title={title} />
    </Dialog>
  );
}

function ImageModalContent({ src, alt, title }: { src: string; alt: string; title?: string }) {
  return (
    <DialogContent className="max-h-[calc(100vh-2rem)] sm:max-w-[min(90vw,1200px)]">
      <DialogTitle className="pr-8">{title || alt || "Image"}</DialogTitle>
      <img src={src} alt={alt} className="max-h-[75vh] w-full rounded bg-white object-contain" />
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted-foreground underline"
      >
        Open in a new tab
      </a>
    </DialogContent>
  );
}

/** A thumbnail that opens the image full size in a modal. */
export function ImagePreview({
  src,
  alt,
  title,
  imgClassName = "",
  className = "",
  onError,
  children,
}: {
  src: string;
  alt: string;
  /** Heading of the modal; defaults to the alt text. */
  title?: string;
  imgClassName?: string;
  className?: string;
  onError?: () => void;
  /** Shown under the thumbnail, inside the clickable area. */
  children?: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        title={title ?? alt}
        className={`cursor-zoom-in text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${className}`}
      >
        <img src={src} alt={alt} loading="lazy" onError={onError} className={imgClassName} />
        {children}
      </DialogTrigger>
      <ImageModalContent src={src} alt={alt} title={title} />
    </Dialog>
  );
}
