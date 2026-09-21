"use client";

import { useEffect, useState } from "react";
import { getPublishedContent } from "@/lib/member-api";

/* Member educational copy that the console edits (Content → Member copy).
   A screen keeps its approved wording as the fallback and swaps in the
   PUBLISHED entry when one exists, so an edit in the console reaches the
   member on the next load without a deploy. */
let cache: Promise<Map<string, string>> | null = null;

function published(): Promise<Map<string, string>> {
  cache ??= getPublishedContent("member_copy")
    .then((entries) => new Map(entries.map((entry) => [entry.key, entry.body])))
    .catch(() => { cache = null; return new Map<string, string>(); });
  return cache;
}

export function usePublishedCopy(key: string, fallback: string): string {
  const [text, setText] = useState(fallback);
  useEffect(() => {
    let cancelled = false;
    published().then((map) => { if (!cancelled && map.has(key)) setText(map.get(key) as string); });
    return () => { cancelled = true; };
  }, [key]);
  return text;
}
