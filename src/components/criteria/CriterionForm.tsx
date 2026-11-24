"use client";

import { useState, useTransition } from "react";
import type { Criterion, CriterionLevel } from "@/lib/criteria";
import { MAX_LEVELS, MIN_LEVELS } from "@/lib/criteria";
import { createCriterion, updateCriterion } from "@/app/actions/criteria";

const DEFAULT_LEVELS: CriterionLevel[] = [
  { name: "노력 필요", score: 1, description: "" },
  { name: "보통", score: 2, description: "" },
  { name: "잘함", score: 3, description: "" },
];

export function CriterionForm({
  criterion,
  attachToBoardId,
  locked,
  onDone,
}: {
  criterion?: Criterion;
  attachToBoardId?: string;
  locked?: boolean;
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState(criterion?.name ?? "");
  const [description, setDescription] = useState(criterion?.description ?? "");
  const [levels, setLevels] = useState<CriterionLevel[]>(criterion?.levels ?? DEFAULT_LEVELS);

  const setLevel = (i: number, patch: Partial<CriterionLevel>) => setLevels(levels.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = { name, description, levels };
          const r = criterion ? await updateCriterion(criterion.id, input) : await createCriterion(input, attachToBoardId);
          if (!r.ok) return setError(r.error);
          setError("");
          if (!criterion) {
            setName("");
            setDescription("");
            setLevels(DEFAULT_LEVELS);
          }
          onDone?.();
        });
      }}
    >
      <div>
        <label className="label" htmlFor="cr-name">
          기준 이름
        </label>
        <input id="cr-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="cr-desc">
          설명
        </label>
        <textarea id="cr-desc" className="input" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <fieldset disabled={locked} className="flex flex-col gap-2">
        <legend className="label">
          단계 ({MIN_LEVELS}~{MAX_LEVELS}개){locked && " — 평가가 있어 바꿀 수 없음"}
        </legend>
        {levels.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_auto] gap-2 sm:grid-cols-[10rem_5rem_1fr_auto]" data-testid="level-row">
            <input className="input py-1" aria-label={`${i + 1}단계 이름`} value={l.name} onChange={(e) => setLevel(i, { name: e.target.value })} required />
            <input
              className="input py-1"
              type="number"
              step="any"
              aria-label={`${i + 1}단계 점수`}
              value={Number.isFinite(l.score) ? l.score : ""}
              onChange={(e) => setLevel(i, { score: e.target.valueAsNumber })}
              required
            />
            <input
              className="input col-span-2 py-1 sm:col-span-1"
              aria-label={`${i + 1}단계 설명`}
              placeholder="설명"
              value={l.description ?? ""}
              onChange={(e) => setLevel(i, { description: e.target.value })}
            />
            <button type="button" className="btn row-start-1 px-2 sm:row-auto" aria-label={`${i + 1}단계 빼기`} onClick={() => setLevels(levels.filter((_, k) => k !== i))}>
              −
            </button>
          </div>
        ))}
        <button type="button" className="btn w-fit" onClick={() => setLevels([...levels, { name: "", score: levels.length + 1, description: "" }])}>
          ＋ 단계 추가
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button className="btn-primary w-fit" disabled={pending}>
        {criterion ? "저장" : attachToBoardId ? "만들고 이 보드에 붙이기" : "기준 만들기"}
      </button>
    </form>
  );
}
