import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Project, TreeNode } from "@/lib/types";
import { formatKST } from "@/lib/datetime";

type Member = { id: string; display_name: string; login_id: string | null; role: "teacher" | "student" };
type RecentCard = { id: string; title: string; board_id: string; author_id: string | null; created_at: string };

const AVATAR = ["#FF8FA3", "#7FD6A4", "#8EC5FF", "#FFD66B", "#C4A8FF", "#FFB38A"];
const nameOf = (m: Pick<Member, "display_name" | "login_id">) => m.display_name || m.login_id || "이름 없음";

function Avatar({ name, i, size = "size-11" }: { name: string; i: number; size?: string }) {
  return (
    <span
      className={`jua inline-flex ${size} shrink-0 items-center justify-center rounded-full text-lg text-ink`}
      style={{ background: AVATAR[i % AVATAR.length] }}
      aria-hidden
    >
      {name.slice(-2)}
    </span>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const isTeacher = me.role === "teacher";
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const p = project as Project;

  const { data: tree } = await supabase.rpc("get_board_tree", { p_project: id });
  const boards = ((tree ?? []) as TreeNode[]).filter((n) => n.accessible);
  const boardIds = boards.map((b) => b.id);
  const boardTitle = new Map(boards.map((b) => [b.id, b.title]));

  const [teacherRes, studentsRes, cardCountRes, recentRes] = await Promise.all([
    supabase.from("profiles").select("id, display_name, login_id, role").eq("id", p.teacher_id).maybeSingle(),
    isTeacher
      ? supabase
          .from("profiles")
          .select("id, display_name, login_id, role")
          .eq("teacher_id", me.id)
          .eq("active", true)
          .order("display_name")
          .order("login_id")
      : supabase.from("profiles").select("id, display_name, login_id, role").eq("id", me.id),
    boardIds.length
      ? supabase.from("cards").select("id", { count: "exact", head: true }).in("board_id", boardIds)
      : Promise.resolve({ count: 0 }),
    boardIds.length
      ? supabase
          .from("cards")
          .select("id, title, board_id, author_id, created_at")
          .in("board_id", boardIds)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);
  const teacher = teacherRes.data as Member | null;
  const students = (studentsRes.data ?? []) as Member[];
  const cardCount = cardCountRes.count ?? 0;
  const recent = (recentRes.data ?? []) as RecentCard[];
  const people = new Map<string, Member>([...students, ...(teacher ? [teacher] : [])].map((m) => [m.id, m]));
  const teacherName = teacher ? nameOf(teacher) : "선생님";

  return (
    <main className="flex flex-col gap-[22px]">
      {/* 배너 */}
      <header className="flex flex-col gap-4 rounded-[20px] bg-primary px-6 py-6 text-white shadow-[0_4px_0_var(--shadow)] sm:px-8 sm:py-7">
        {p.archived_at && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-white/20 text-white">보관됨</span>
          </div>
        )}
        <h1 className="text-4xl leading-tight break-keep text-white sm:text-5xl" data-testid="project-title">
          {p.title}
        </h1>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={teacherName} i={0} size="size-12" />
            <span className="text-lg font-bold">
              {teacherName} <span className="text-sm font-normal text-primary-soft">선생님</span>
            </span>
          </div>
          <dl className="ml-auto flex gap-5 text-primary-soft">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-sm">작업장</dt>
              <dd className="jua text-3xl text-white">{boards.length}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-sm">카드</dt>
              <dd className="jua text-3xl text-accent" data-testid="project-card-count">
                {cardCount}
              </dd>
            </div>
            {isTeacher && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-sm">학생</dt>
                <dd className="jua text-3xl text-white">{students.length}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <div className="grid gap-[22px] xl:grid-cols-3">
        {/* 프로젝트 소개 */}
        <section className="card-panel flex flex-col gap-4 p-6" aria-labelledby="intro-h">
          <h2 id="intro-h" className="text-[26px]">
            프로젝트 소개
          </h2>
          {p.goal ? (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{p.goal}</p>
          ) : (
            <p className="text-sm text-muted">아직 소개가 없어요.</p>
          )}
          <h3 className="jua mt-2 text-xl">프로젝트 정보</h3>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-[15px]">
            <dt className="text-muted">개설자</dt>
            <dd>{teacherName}</dd>
            <dt className="text-muted">기간</dt>
            <dd>
              {p.start_date ?? "?"} ~ {p.end_date ?? "?"}
            </dd>
            <dt className="text-muted">만든 날</dt>
            <dd>{p.created_at.slice(0, 10)}</dd>
          </dl>
        </section>

        {/* 최신 카드 */}
        <section className="card-panel flex flex-col gap-4 p-6" aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-[26px]">
            최신 카드
          </h2>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">아직 카드가 없어요. 작업장에 들어가 첫 카드를 써 보세요.</p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="recent-cards">
              {recent.map((c, i) => {
                const author = c.author_id ? people.get(c.author_id) : undefined;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/projects/${id}/boards/${c.board_id}`}
                      className="flex flex-col gap-1.5 rounded-2xl px-4 py-3 transition hover:brightness-95"
                      style={{ background: ["#D4E8F8", "#FBF0C0", "#D6F0DC", "#F9D5F0", "#E3DAF7"][i % 5] }}
                    >
                      <span className="text-xs font-bold text-muted">{boardTitle.get(c.board_id)}</span>
                      <span className="jua text-xl leading-snug break-keep text-ink">{c.title}</span>
                      <span className="text-[13px] text-muted">
                        {author ? nameOf(author) : "친구"} · {formatKST(c.created_at, "monthDayTime")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 멤버 */}
        <section className="card-panel flex flex-col gap-4 p-6" aria-labelledby="member-h">
          <div className="flex items-center gap-2">
            <h2 id="member-h" className="text-[26px]">
              멤버
            </h2>
            {isTeacher && <span className="jua text-2xl text-danger">{students.length + 1}명</span>}
            {isTeacher && (
              <Link href="/students" className="btn ml-auto">
                학생 관리
              </Link>
            )}
          </div>
          <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto pr-1" data-testid="members">
            {teacher && (
              <li className="flex items-center gap-3 rounded-2xl border-2 border-surface px-3 py-2">
                <Avatar name={teacherName} i={0} />
                <span className="badge bg-primary text-white">선생님</span>
                <span className="min-w-0 flex-1 truncate font-bold">{teacherName}</span>
              </li>
            )}
            {students.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl border-2 border-surface px-3 py-2">
                <Avatar name={nameOf(s)} i={i + 1} />
                <span className="badge bg-surface text-muted">학생</span>
                <span className="min-w-0 flex-1 truncate">
                  <b>{nameOf(s)}</b> <span className="text-sm text-muted">({s.login_id})</span>
                </span>
              </li>
            ))}
            {isTeacher && students.length === 0 && (
              <li className="py-4 text-center text-sm text-muted">
                아직 학생이 없어요.{" "}
                <Link href="/students" className="font-bold text-primary underline">
                  학생 계정 만들기
                </Link>
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
