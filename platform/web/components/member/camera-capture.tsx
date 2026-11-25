"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitGhost } from "@/components/use-exit-ghost";
import { useModalDialog } from "@/components/use-modal-dialog";
import styles from "@/components/avatar-crop-dialog.module.css";

/* "Snap a photo" on a computer: the webcam in a dialog (Take photo → Use it /
   Retake). A phone does not come here — its camera opens straight from the
   file input (`capture`), which is what people expect there.

   The camera is switched off whenever the dialog closes, however it closes,
   and nothing leaves the browser until the meal is saved. */

type Props = {
  onUse: (photo: Blob) => void;
  onCancel: () => void;
  /** When the camera cannot start: the way on, rather than a dead button. */
  onChooseFile: () => void;
};

type Phase = "starting" | "live" | "taken" | "blocked";

export function CameraCapture({ onUse, onCancel, onChooseFile }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState("");
  const opening = useRef(0);   // the attempt the dialog is waiting for; 0 = closed
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  const stop = useCallback(() => {
    opening.current = 0;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    setMessage("");
    const mine = Date.now() + Math.random();
    opening.current = mine;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
      // Permission can be given after the dialog closed (or was reopened): a
      // camera nobody is waiting for is switched straight off.
      if (opening.current !== mine) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setPhase("live");
    } catch (reason) {
      if (opening.current !== mine) return;
      const name = reason instanceof DOMException ? reason.name : "";
      setMessage(name === "NotAllowedError" || name === "SecurityError"
        ? "Camera access was blocked. Allow the camera for this site in your browser, or choose a file instead."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No camera was found on this device. Choose a file instead."
          : "The camera could not be started. Choose a file instead.");
      setPhase("blocked");
    }
  }, []);

  useEffect(() => {
    void start();
    return () => stop();
  }, [start, stop]);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const close = useCallback(() => { stop(); onCancel(); }, [onCancel, stop]);
  const overlay = useRef<HTMLDivElement>(null);
  useModalDialog(true, card, close, "[data-camera-cancel]");
  useExitGhost(overlay);
  // The main button changes with each step; focus follows it, never lost
  // behind the dialog.
  useEffect(() => {
    if (phase !== "starting") card.current?.querySelector<HTMLElement>("[data-camera-primary]")?.focus();
  }, [phase]);

  function take() {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { setMessage("That photo could not be taken. Try again."); return; }
      setShot({ blob, url: URL.createObjectURL(blob) });
      setPhase("taken");
      stop();
    }, "image/jpeg", 0.92);
  }

  function retake() {
    setShot(null);
    void start();
  }

  function use() {
    if (!shot) return;
    onUse(shot.blob);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.overlay} ref={overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.card} ref={card} role="dialog" aria-modal="true" aria-labelledby="cameraTitle" data-testid="camera-dialog">
        <h2 className={styles.title} id="cameraTitle">Snap a photo of your meal</h2>
        <p className={styles.sub}>Take the photo, then use it — it is added when you save the meal.</p>
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#1d2614", aspectRatio: "4 / 3" }}>
          <video ref={video} playsInline muted aria-label="Camera preview" data-testid="camera-preview"
                 style={{ width: "100%", height: "100%", objectFit: "cover", display: phase === "taken" ? "none" : "block" }} />
          {shot && <img src={shot.url} alt="The photo you took" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        </div>
        {message && <p className={styles.error} role="alert">{message}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn-ghost" onClick={close} data-camera-cancel>Cancel</button>
          {phase === "blocked" ? (
            <button type="button" className="btn-primary" onClick={() => { stop(); onChooseFile(); }} data-camera-primary data-testid="camera-choose-file">
              Choose a file instead
            </button>
          ) : phase === "taken" ? (
            <>
              <button type="button" className="btn-ghost" onClick={retake}>Retake</button>
              <button type="button" className="btn-primary" onClick={use} data-camera-primary data-testid="camera-use">Use photo</button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={take} disabled={phase !== "live"} data-camera-primary data-testid="camera-take">
              {phase === "starting" ? "Starting camera…" : "Take photo"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
