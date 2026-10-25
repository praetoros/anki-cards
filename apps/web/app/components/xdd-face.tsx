import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { useTheme } from "~/lib/theme";

/**
 * The face drawn at webcam-thumbnail resolution and scaled up with square pixels. It draws
 * `/xdd.svg` (the same face in fixed colours), since an SVG loaded as an image can't read
 * CSS variables.
 */
export function XddBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = "/xdd.svg";
  }, []);
  return (
    <canvas
      ref={ref}
      width={50}
      height={35}
      aria-hidden
      className={`[image-rendering:pixelated] ${className}`}
    />
  );
}

/** The xdd emote: pale face, slit eyes, orange nose, a row of teeth. */
export function XddFace({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 140" aria-hidden className={className}>
      <ellipse cx="100" cy="70" rx="98" ry="68" fill="var(--xdd-fur)" />
      <ellipse cx="62" cy="70" rx="34" ry="26" fill="var(--xdd-smudge)" opacity="0.35" />
      <ellipse cx="48" cy="42" rx="26" ry="8" transform="rotate(12 48 42)" fill="var(--xdd-void)" />
      <ellipse
        cx="152"
        cy="42"
        rx="26"
        ry="8"
        transform="rotate(-10 152 42)"
        fill="var(--xdd-void)"
      />
      <ellipse cx="104" cy="80" rx="20" ry="13" fill="var(--xdd-nose)" />
      <path d="M58 92 Q104 134 150 90 Q104 120 58 92Z" fill="var(--xdd-void)" opacity="0.7" />
      <rect x="78" y="101" width="14" height="11" rx="4" fill="var(--xdd-teeth)" />
      <rect x="94" y="104" width="14" height="11" rx="4" fill="var(--xdd-teeth)" />
      <rect x="110" y="104" width="14" height="11" rx="4" fill="var(--xdd-teeth)" />
      <rect x="126" y="101" width="14" height="11" rx="4" fill="var(--xdd-teeth)" />
    </svg>
  );
}

const SPINNER_SIZES = {
  xs: { icon: "size-3", face: "w-4" },
  sm: { icon: "size-4", face: "w-6" },
  md: { icon: "size-5", face: "w-7" },
};

/** A loading spinner: a circle normally, a spinning xdd face in the xdd theme. */
export function Spinner({
  size = "sm",
  className = "",
}: {
  size?: keyof typeof SPINNER_SIZES;
  className?: string;
}) {
  const sizes = SPINNER_SIZES[size];
  return useTheme() === "xdd" ? (
    <XddFace className={`${sizes.face} shrink-0 animate-spin ${className}`} />
  ) : (
    <LoaderCircle className={`${sizes.icon} shrink-0 animate-spin ${className}`} />
  );
}
