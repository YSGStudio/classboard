"use client";

import { Kanban } from "@/components/kanban/Kanban";
import type { BoardView } from "@/lib/types";

export function EvaluationTarget({ title, view }: { title: string; view: BoardView }) {
  return (
    <div className="mb-4 rounded-2xl bg-card shadow-[0_4px_0_var(--shadow)] pt-2">
      <h2 className="px-3 pb-2 font-bold">
        {title} <span className="text-sm font-normal text-slate-500">카드 {view.cards.length}개</span>
      </h2>
      <Kanban view={{ ...view, board: { ...view.board, can_write: false } }} isTeacher readOnly onChanged={() => {}} />
    </div>
  );
}
