"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEvaluationPublished } from "@/app/actions/evaluations";

export function PublishAll({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const go = (published: boolean) =>
    start(async () => {
      const r = await setEvaluationPublished(boardId, null, published);
      setMsg(r.ok ? `${r.data?.count ?? 0}건을 ${published ? "공개" : "공개 취소"}했습니다.` : r.error);
      router.refresh();
    });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button className="btn-primary" disabled={pending} onClick={() => go(true)}>
        보드 전체 평가 공개
      </button>
      <button className="btn" disabled={pending} onClick={() => go(false)}>
        전체 공개 취소
      </button>
      {msg && <span className="text-sm text-slate-600">{msg}</span>}
    </div>
  );
}
