import type { BoardView } from "@/lib/types";

export function CriteriaPanel({ view }: { view: BoardView }) {
  if (!view.criteria.length) return null;
  return (
    <details className="card-panel mx-3 mb-3" data-testid="criteria-panel">
      <summary className="cursor-pointer font-bold">평가 기준 {view.criteria.length}개</summary>
      <ul className="mt-2 flex flex-col gap-3">
        {view.criteria.map((c) => (
          <li key={c.id}>
            <p className="font-medium">{c.name}</p>
            {c.description && <p className="text-sm text-slate-600">{c.description}</p>}
            <ol className="mt-1 flex flex-wrap gap-2 text-sm">
              {c.levels.map((l, i) => (
                <li key={i} className="rounded-lg bg-surface px-2.5 py-1">
                  <b>{l.name}</b> ({l.score}점){l.description ? ` — ${l.description}` : ""}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MyEvaluationPanel({ view }: { view: BoardView }) {
  const e = view.my_evaluation;
  if (!e) return null;
  return (
    <section className="mx-3 mb-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4" data-testid="my-evaluation">
      <h2 className="mb-2 jua text-xl text-emerald-900">선생님 평가</h2>
      <ul className="flex flex-col gap-2">
        {e.criteria.map((c) => {
          const idx = e.levels[c.id];
          const level = c.levels[idx];
          return (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="rounded-full bg-emerald-600 px-3 py-0.5 text-sm font-bold text-white">
                {level ? `${level.name} (${level.score}점)` : "—"}
              </span>
            </li>
          );
        })}
      </ul>
      {e.feedback && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-card p-3 text-slate-800">{e.feedback}</p>}
    </section>
  );
}
