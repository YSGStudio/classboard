"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "./pdf";

type Doc = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]>["promise"]>;

export function PdfViewer({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let d: Doc | null = null;
    let cancelled = false;
    loadPdfJs()
      .then((pdfjs) => pdfjs.getDocument({ url }).promise)
      .then((loaded) => {
        d = loaded;
        if (cancelled) loaded.loadingTask.destroy();
        else setDoc(loaded);
      })
      .catch(() => setError("PDF를 열 수 없습니다."));
    return () => {
      cancelled = true;
      d?.loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let cancelled = false;
    doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current) return;
      const width = box.current?.clientWidth ?? 600;
      const base = p.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: (width / base.width) * ratio });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / ratio)}px`;
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);

  return (
    <div ref={box} className="flex w-full flex-col gap-2" data-testid="pdf-viewer">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="이전 페이지">
          ◀
        </button>
        <span data-testid="pdf-page">
          {page} / {doc?.numPages ?? "?"}
        </span>
        <button
          className="btn"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage(page + 1)}
          aria-label="다음 페이지"
        >
          ▶
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : <canvas ref={canvas} className="max-w-full border-2 border-edge bg-card" />}
    </div>
  );
}
