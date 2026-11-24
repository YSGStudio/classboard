"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

export const BUCKET = "card-attachments";
const cache = new Map<string, { url: string; exp: number }>();

/** 비공개 버킷 파일의 서명된 URL(1시간). Storage 정책이 카드 읽기 권한을 확인한다. */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const key = [...new Set(paths)].sort().join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = key ? key.split("|") : [];
    const now = Date.now();
    const missing = list.filter((p) => !cache.has(p) || cache.get(p)!.exp < now + 60_000);
    const fill = () => {
      const out: Record<string, string> = {};
      for (const p of list) {
        const c = cache.get(p);
        if (c) out[p] = c.url;
      }
      setUrls(out);
    };
    if (!missing.length) {
      fill();
      return;
    }
    let cancelled = false;
    getBrowserClient()
      .storage.from(BUCKET)
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        for (const d of data ?? []) {
          if (d.signedUrl && d.path) cache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3600_000 });
        }
        if (!cancelled) fill();
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
}
