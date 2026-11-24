"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  issueStudentsAction,
  reissuePinAction,
  renameStudentAction,
  setStudentActiveAction,
} from "@/app/actions/students";

export type StudentRow = { id: string; login_id: string; display_name: string; active: boolean };
type Issued = { login_id: string; display_name: string; pin: string };

function downloadCsv(rows: Issued[]) {
  const body = ["아이디,이름,비밀번호", ...rows.map((r) => `${r.login_id},${r.display_name.replace(/,/g, " ")},${r.pin}`)].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `학생계정_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function StudentsClient({ students }: { students: StudentRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [csv, setCsv] = useState("");
  const [single, setSingle] = useState({ login_id: "", display_name: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [issued, setIssued] = useState<Issued[]>([]);
  const [message, setMessage] = useState("");

  const run = (input: Parameters<typeof issueStudentsAction>[0]) =>
    start(async () => {
      setErrors([]);
      setMessage("");
      const r = await issueStudentsAction(input);
      if (!r.ok) {
        setErrors(r.errors ?? [r.error]);
        return;
      }
      setIssued(r.data ?? []);
      setCsv("");
      setSingle({ login_id: "", display_name: "" });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card-panel">
          <h2 className="mb-3 font-bold">한 명 발급</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run({ single });
            }}
          >
            <div>
              <label className="label" htmlFor="single-name">
                이름
              </label>
              <input
                id="single-name"
                className="input"
                value={single.display_name}
                onChange={(e) => setSingle({ ...single, display_name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="single-id">
                아이디 (비우면 자동 생성)
              </label>
              <input
                id="single-id"
                className="input"
                value={single.login_id}
                onChange={(e) => setSingle({ ...single, login_id: e.target.value })}
                placeholder="예: kim01"
              />
            </div>
            <button className="btn-primary" disabled={pending}>
              발급
            </button>
          </form>
        </div>
        <div className="card-panel">
          <h2 className="mb-1 font-bold">CSV로 일괄 발급</h2>
          <p className="mb-2 text-sm text-slate-600">한 줄에 한 명씩 &quot;아이디,이름&quot;. 아이디를 비우면 자동 생성됩니다.</p>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run({ csv });
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV 파일"
              className="text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
            <textarea
              aria-label="CSV 내용"
              className="input h-32 font-mono text-sm"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={"아이디,이름\nkim01,김하나\n,이두리"}
            />
            <button className="btn-primary" disabled={pending || !csv.trim()}>
              {pending ? "발급 중…" : "일괄 발급"}
            </button>
          </form>
        </div>
      </section>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <p className="font-bold">발급하지 않았습니다.</p>
          <ul className="list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {issued.length > 0 && (
        <section className="card-panel border-[3px] border-accent bg-done shadow-none print:border-0 print:bg-card" data-testid="issued">
          <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
            <h2 className="font-bold">발급된 계정 {issued.length}명</h2>
            <span className="text-sm text-amber-800">비밀번호는 지금만 볼 수 있습니다.</span>
            <button className="btn ml-auto" onClick={() => downloadCsv(issued)}>
              CSV 내려받기
            </button>
            <button className="btn" onClick={() => window.print()}>
              인쇄
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-1">이름</th>
                  <th className="p-1">아이디</th>
                  <th className="p-1">비밀번호</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((s) => (
                  <tr key={s.login_id} className="border-t-2 border-amber-200">
                    <td className="p-1">{s.display_name}</td>
                    <td className="p-1 font-mono">{s.login_id}</td>
                    <td className="p-1 font-mono text-lg tracking-widest" data-testid="issued-pin">
                      {s.pin}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

      <section className="card-panel print:hidden">
        <h2 className="mb-3 font-bold">등록된 학생 {students.length}명</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="p-2">이름</th>
                <th className="p-2">아이디</th>
                <th className="p-2">상태</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <StudentLine
                  key={s.id}
                  s={s}
                  onPin={(r) => setIssued([{ login_id: r.login_id, display_name: s.display_name, pin: r.pin }])}
                  onMessage={setMessage}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StudentLine({
  s,
  onPin,
  onMessage,
}: {
  s: StudentRow;
  onPin: (r: { login_id: string; pin: string }) => void;
  onMessage: (m: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(s.display_name);
  return (
    <tr className="border-t-2 border-surface" data-testid={`student-${s.login_id}`}>
      <td className="p-2">
        <input
          className="input py-1"
          aria-label={`${s.login_id} 이름`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== s.display_name) start(async () => void (await renameStudentAction(s.id, name)));
          }}
        />
      </td>
      <td className="p-2 font-mono">{s.login_id}</td>
      <td className="p-2">{s.active ? "사용 중" : <span className="text-red-700">비활성</span>}</td>
      <td className="flex flex-wrap justify-end gap-2 p-2">
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reissuePinAction(s.id);
              if (r.ok && r.data) onPin(r.data);
              else if (!r.ok) onMessage(r.error);
            })
          }
        >
          비밀번호 재발급
        </button>
        <button
          className={s.active ? "btn-danger" : "btn"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setStudentActiveAction(s.id, !s.active);
              if (!r.ok) onMessage(r.error);
              router.refresh();
            })
          }
        >
          {s.active ? "비활성화" : "다시 사용"}
        </button>
      </td>
    </tr>
  );
}
