"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/components/use-modal-dialog";
import styles from "./avatar-crop-dialog.module.css";

/* The circular crop editor (owner request, 15 Nov 2026: "crop it exactly
   like it's going to appear in my avatar", as Instagram does).

   The person moves and zooms the picture inside a square frame whose
   inscribed circle IS the avatar. What is sent is the square in the upright
   original's own pixels; the API cuts both avatar sizes from exactly that
   square of the original it keeps, so the frame, the two previews and the
   saved avatar are the same pixels. Browsers draw a phone photo upright
   (EXIF orientation), and the API rotates it the same way before cutting,
   so the numbers mean the same thing on both sides.

   Moving: drag (mouse, touch, pen), two-finger pinch, the wheel, the zoom
   slider and its buttons, or the keyboard on the focused frame (arrows move,
   + and - zoom, 0 resets). */

export type PhotoCrop = { x: number; y: number; size: number };

type Props = {
  /** An object URL for a newly chosen file, or the stored original's URL. */
  src: string;
  /** Where to start: the picture's current crop when re-cropping. */
  initial?: PhotoCrop | null;
  title?: string;
  saveLabel?: string;
  /** The portal's own button classes, so the editor looks at home in both. */
  primaryClass: string;
  secondaryClass: string;
  onCancel: () => void;
  /** Resolve to close; reject with an Error whose message is shown. */
  onSave: (crop: PhotoCrop) => Promise<void>;
};

const MIN_CROP_SIDE = 64;  // never zoom in past a 64 px square of the original
const MAX_ZOOM = 8;
const KEY_STEP = 10;       // CSS px per arrow press (Shift: four times that)

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function AvatarCropDialog({ src, initial, title = "Crop your picture", saveLabel = "Save picture", primaryClass, secondaryClass, onCancel, onSave }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState(300);
  // State lives in the ORIGINAL's pixels: the crop square's side follows
  // from the zoom, and (cx, cy) is its centre.
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState<{ cx: number; cy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unreadable, setUnreadable] = useState(false);

  const close = useCallback(() => { if (!busy) onCancel(); }, [busy, onCancel]);
  useModalDialog(true, card, close, "[data-crop-frame]");

  const minSide = natural ? Math.min(natural.w, natural.h) : 1;
  const maxZoom = natural ? clamp(minSide / Math.min(MIN_CROP_SIDE, minSide), 1, MAX_ZOOM) : 1;
  const side = minSide / zoom;  // the crop square's side, original px

  // The frame is responsive: measure it, so dragging maps CSS px to pixels.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame(el.clientWidth || 300);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const keepInside = useCallback((cx: number, cy: number, s: number) => {
    if (!natural) return { cx, cy };
    return { cx: clamp(cx, s / 2, natural.w - s / 2), cy: clamp(cy, s / 2, natural.h - s / 2) };
  }, [natural]);

  function loaded(event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { setUnreadable(true); return; }
    setNatural({ w, h });
    const least = Math.min(w, h);
    if (initial && initial.size > 0 && initial.x + initial.size <= w && initial.y + initial.size <= h) {
      setZoom(clamp(least / initial.size, 1, clamp(least / Math.min(MIN_CROP_SIDE, least), 1, MAX_ZOOM)));
      setCentre({ cx: initial.x + initial.size / 2, cy: initial.y + initial.size / 2 });
    } else {
      setZoom(1);
      setCentre({ cx: w / 2, cy: h / 2 });
    }
  }

  const setZoomKeeping = useCallback((next: number) => {
    const z = clamp(next, 1, maxZoom);
    setZoom(z);
    setCentre((current) => current && keepInside(current.cx, current.cy, minSide / z));
  }, [keepInside, maxZoom, minSide]);

  const panBy = useCallback((dx: number, dy: number) => {
    const scale = frame / side;  // CSS px per original px
    setCentre((current) => current && keepInside(current.cx - dx / scale, current.cy - dy / scale, side));
  }, [frame, keepInside, side]);

  // The square that will be saved: integers, inside the picture.
  const crop = useMemo<PhotoCrop | null>(() => {
    if (!natural || !centre) return null;
    const size = Math.min(Math.round(side), natural.w, natural.h);
    return {
      size,
      x: clamp(Math.round(centre.cx - size / 2), 0, natural.w - size),
      y: clamp(Math.round(centre.cy - size / 2), 0, natural.h - size),
    };
  }, [centre, natural, side]);

  // ---- pointers: drag with one, pinch with two --------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function down(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: spread(), zoom };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const now = spread();
      if (pinch.current.distance > 0) setZoomKeeping(pinch.current.zoom * (now / pinch.current.distance));
    } else {
      panBy(event.clientX - previous.x, event.clientY - previous.y);
    }
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // The wheel zooms; a passive React listener could not stop the page from
  // scrolling behind the dialog, so this one is attached by hand.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoomKeeping(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [setZoomKeeping, zoom]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    // The arrows move the PICTURE, as a drag does: Left slides it left, so
    // the circle shows more of its right-hand side.
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key in moves) { event.preventDefault(); panBy(...moves[event.key]); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoomKeeping(zoom * 1.1); return; }
    if (event.key === "-" || event.key === "_") { event.preventDefault(); setZoomKeeping(zoom / 1.1); return; }
    if (event.key === "0") { event.preventDefault(); setZoomKeeping(1); }
  }

  async function save() {
    if (!crop) return;
    setBusy(true);
    setError("");
    try {
      await onSave(crop);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The picture could not be saved.");
      setBusy(false);
    }
  }

  // ---- drawing -----------------------------------------------------------------
  const scale = frame / side;
  const imageStyle: CSSProperties | undefined = natural && centre ? {
    width: natural.w * scale, height: natural.h * scale,
    left: frame / 2 - centre.cx * scale, top: frame / 2 - centre.cy * scale,
  } : { opacity: 0 };
  // The previews use the integer square that will be saved, not the live
  // float one, so they are exactly the avatar.
  const preview = (px: number): CSSProperties | undefined => {
    if (!crop || !natural) return { width: px, height: px };
    const k = px / crop.size;
    return {
      width: px, height: px, backgroundImage: `url("${src}")`,
      backgroundSize: `${natural.w * k}px ${natural.h * k}px`, backgroundPosition: `${-crop.x * k}px ${-crop.y * k}px`,
    };
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.card} ref={card} role="dialog" aria-modal="true" aria-labelledby="avatarCropTitle"
           aria-describedby="avatarCropHelp" data-testid="crop-dialog">
        <h2 className={styles.title} id="avatarCropTitle">{title}</h2>
        <p className={styles.sub} id="avatarCropHelp">
          Drag to move the picture and zoom to fit. The circle is exactly how your picture will appear.
        </p>
        {unreadable ? (
          <p className={styles.error} role="alert">That file could not be read as an image. Please choose a JPG, PNG or WebP picture.</p>
        ) : (
          <>
            <div className={styles.stage}>
              <div className={styles.frame} ref={frameRef} data-crop-frame tabIndex={0} role="group"
                   aria-label="Picture position. Use the arrow keys to move it, plus and minus to zoom."
                   data-testid="crop-frame" data-crop={crop ? `${crop.x},${crop.y},${crop.size}` : ""}
                   onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={keys}>
                <img className={styles.image} src={src} alt="" draggable={false} style={imageStyle}
                     onLoad={loaded} onError={() => setUnreadable(true)} />
                <span className={styles.mask} aria-hidden="true" />
              </div>
              <div className={styles.previews} aria-hidden="true">
                <span className={styles.previewLabel}>Preview</span>
                <span className={styles.preview} style={preview(96)} data-testid="crop-preview" />
                <span className={styles.preview} style={preview(40)} />
              </div>
            </div>
            <div className={styles.zoom}>
              <button type="button" className={styles.zoomButton} aria-label="Zoom out" onClick={() => setZoomKeeping(zoom / 1.15)} disabled={zoom <= 1 || !natural}>&minus;</button>
              <input type="range" min={1} max={maxZoom} step={0.01} value={zoom} aria-label="Zoom" disabled={!natural || maxZoom <= 1}
                     onChange={(event) => setZoomKeeping(Number(event.target.value))} data-testid="crop-zoom" />
              <button type="button" className={styles.zoomButton} aria-label="Zoom in" onClick={() => setZoomKeeping(zoom * 1.15)} disabled={zoom >= maxZoom || !natural}>+</button>
            </div>
            <p className={styles.hint}>Only this square is used for your picture; the photo you chose is kept so you can adjust it later.</p>
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={secondaryClass} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={primaryClass} onClick={() => void save()} disabled={busy || !crop || unreadable} data-testid="crop-save">
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
