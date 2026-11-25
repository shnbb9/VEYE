"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/* A screen's own stylesheets, and nothing drawn before they arrive.

   Each part of Veye (the site, sign-in, the member app, the console) carries
   its own approved stylesheet, attached by the screen. Attached that way a
   sheet loads AFTER the markup it styles, so on anything but a fast network
   the raw page showed for up to a second — and again whenever a loading screen
   unmounted its copy and the real one attached it anew (recorded 25 Nov 2026).

   So: the sheets are attached once, above whatever swaps inside, and the
   content stays invisible (not unmounted, not shifted) until they have loaded
   or failed. The server's HTML needs no gate — there the browser already waits
   for a sheet before painting what follows it. */

const GIVE_UP = 5000;   // a sheet that never answers must not hide the page for ever
const FAILED = new Set<string>();

function sheetLoaded(href: string): boolean {
  if (FAILED.has(href)) return true;
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some((link) => link.getAttribute("href") === href && link.sheet !== null);
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function ScreenStyles({ sheets, fonts, waiting, children }: {
  sheets: readonly string[]; fonts?: string;
  /** What shows over the page while its sheets arrive. */
  waiting?: ReactNode; children: ReactNode;
}) {
  const loaded = useSyncExternalStore(subscribe, () => sheets.every(sheetLoaded), () => true);
  const [gaveUp, setGaveUp] = useState(false);
  const ready = loaded || gaveUp;

  // Once attached, look again: a cached sheet can be there before its load
  // event could have been heard.
  useEffect(() => {
    changed();
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {fonts && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href={fonts} rel="stylesheet" />
        </>
      )}
      {sheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} onLoad={() => { FAILED.delete(href); changed(); }} onError={() => { FAILED.add(href); changed(); }} />
      ))}
      {!ready && waiting && <div className="screen-waiting">{waiting}</div>}
      <div style={ready ? { display: "contents" } : { display: "contents", visibility: "hidden" }} data-styles={ready ? "ready" : "loading"}>{children}</div>
    </>
  );
}
