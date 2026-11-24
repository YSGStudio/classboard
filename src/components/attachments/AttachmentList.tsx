"use client";

import { useState } from "react";
import type { AttachmentView } from "@/lib/types";
import { LinkCard } from "./LinkCard";
import { PdfViewer } from "./PdfViewer";
import { useSignedUrls } from "./useSignedUrls";

/** 카드 위 썸네일(작게) */
export function AttachmentThumbs({ items }: { items: AttachmentView[] }) {
  const urls = useSignedUrls(items.map((a) => a.thumb_path).filter(Boolean) as string[]);
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {items
          .filter((a) => a.type !== "link")
          .map((a) =>
            a.thumb_path && urls[a.thumb_path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={a.id}
                src={urls[a.thumb_path]}
                alt={a.name}
                className="h-16 max-w-[7rem] rounded-lg border-2 border-edge bg-white object-contain"
                data-testid={a.type === "pdf" ? "pdf-thumb" : "image-thumb"}
              />
            ) : (
              <span key={a.id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs">
                {a.type === "pdf" ? "📄" : "🖼"} {a.name}
              </span>
            ),
          )}
      </div>
      {items
        .filter((a) => a.type === "link")
        .map((a) => (
          <LinkCard key={a.id} a={a} compact />
        ))}
    </div>
  );
}

/** 카드 상세의 첨부 목록: 이미지 크게 보기, PDF 뷰어, 링크 카드 */
export function AttachmentDetail({
  items,
  canEdit,
  onDelete,
}: {
  items: AttachmentView[];
  canEdit: boolean;
  onDelete: (id: string) => void;
}) {
  const paths = items.flatMap((a) => [a.thumb_path, a.storage_path]).filter(Boolean) as string[];
  const urls = useSignedUrls(paths);
  const [zoom, setZoom] = useState<string | null>(null);
  const [pdf, setPdf] = useState<AttachmentView | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {items.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {a.type === "image" && (
              <button type="button" className="block" onClick={() => setZoom(a.storage_path && urls[a.storage_path] ? urls[a.storage_path] : null)} aria-label={`${a.name} 크게 보기`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={(a.thumb_path && urls[a.thumb_path]) || (a.storage_path && urls[a.storage_path]) || ""} alt={a.name} className="max-h-40 rounded-xl border-2 border-edge bg-white object-contain" />
              </button>
            )}
            {a.type === "pdf" && (
              <button type="button" className="flex items-center gap-2 text-left" onClick={() => setPdf(a)} aria-label={`${a.name} 보기`}>
                {a.thumb_path && urls[a.thumb_path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[a.thumb_path]} alt="" className="h-28 rounded-xl border-2 border-edge bg-white object-contain" data-testid="pdf-thumb" />
                )}
                <span className="text-sm">
                  📄 {a.name}
                  {a.page_count ? ` · ${a.page_count}쪽` : ""}
                </span>
              </button>
            )}
            {a.type === "link" && <LinkCard a={a} />}
          </div>
          {canEdit && (
            <button type="button" className="text-xs text-red-700 underline" onClick={() => onDelete(a.id)}>
              삭제
            </button>
          )}
        </div>
      ))}
      {pdf && pdf.storage_path && urls[pdf.storage_path] && (
        <div className="rounded-xl border-2 border-edge p-2">
          <div className="mb-1 text-right">
            <button className="text-sm underline" onClick={() => setPdf(null)}>
              닫기
            </button>
          </div>
          <PdfViewer url={urls[pdf.storage_path]} name={pdf.name} />
        </div>
      )}
      {zoom && (
        <div
          role="dialog"
          aria-label="이미지 크게 보기"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" data-testid="image-full" />
        </div>
      )}
    </div>
  );
}
