"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { BUCKET } from "./useSignedUrls";
import { IMAGE_MAX, IMAGE_TYPES, PDF_MAX, imageThumbnail, pdfThumbnail } from "./thumbs";

function ext(file: File) {
  const m = /\.([a-z0-9]+)$/i.exec(file.name);
  if (m) return m[1].toLowerCase();
  return file.type.split("/")[1] ?? "bin";
}

export function AttachmentUploader({ boardId, cardId, onDone }: { boardId: string; cardId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");

  async function uploadFile(file: File) {
    setError("");
    const isImage = IMAGE_TYPES.includes(file.type);
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) return setError("이미지(JPG·PNG·GIF·WebP)나 PDF만 첨부할 수 있습니다.");
    if (isImage && file.size > IMAGE_MAX) return setError("이미지는 10MB 이하여야 합니다.");
    if (isPdf && file.size > PDF_MAX) return setError("PDF는 20MB 이하여야 합니다.");
    setBusy(true);
    try {
      const supabase = getBrowserClient();
      const id = crypto.randomUUID();
      const base = `${boardId}/${cardId}/${id}`;
      let thumb: Blob | null = null;
      let pages: number | null = null;
      try {
        if (isImage) thumb = await imageThumbnail(file);
        else {
          const r = await pdfThumbnail(file);
          thumb = r.thumb;
          pages = r.pages;
        }
      } catch {
        thumb = null; // 썸네일 실패 시 원본만
      }
      const path = `${base}.${ext(file)}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      let thumbPath: string | null = null;
      if (thumb) {
        thumbPath = `${base}.thumb.png`;
        const t = await supabase.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: "image/png" });
        if (t.error) thumbPath = null;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error: e } = await supabase.from("attachments").insert({
        card_id: cardId,
        type: isImage ? "image" : "pdf",
        name: file.name.slice(0, 255),
        storage_path: path,
        thumb_path: thumbPath,
        size: file.size,
        page_count: pages,
        created_by: user?.id,
      });
      if (e) {
        await supabase.storage.from(BUCKET).remove([path, ...(thumbPath ? [thumbPath] : [])]);
        throw new Error(e.message);
      }
      onDone();
    } catch (e) {
      setError(`첨부하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    setError("");
    let url = link.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      return setError("링크 주소가 올바르지 않습니다.");
    }
    setBusy(true);
    try {
      // 미리보기는 서버가 가져와 캐시한다(실패하거나 내부망이면 URL만 표시)
      await fetch("/api/link-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => null);
      const supabase = getBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      const { error: e } = await supabase.from("attachments").insert({ card_id: cardId, type: "link", url, name: url.slice(0, 255), created_by: user?.id });
      if (e) throw new Error(e.message);
      setLink("");
      onDone();
    } catch (e) {
      setError(`링크를 추가하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="btn w-fit cursor-pointer">
        {busy ? "올리는 중…" : "파일 첨부 (이미지·PDF)"}
        <input
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          disabled={busy}
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) uploadFile(f);
          }}
        />
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) addLink();
        }}
      >
        <input className="input py-1 text-sm" placeholder="링크 주소" aria-label="링크 주소" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn shrink-0" disabled={busy || !link.trim()}>
          링크 추가
        </button>
      </form>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
