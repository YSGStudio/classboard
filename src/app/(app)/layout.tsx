import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";

const navLink = "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-primary-soft transition hover:bg-white/12 hover:text-white";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <>
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6">
        <nav className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-2 gap-y-1 rounded-[20px] bg-primary px-4 py-2 text-white shadow-[0_4px_0_var(--shadow)] sm:px-6">
          <Link href="/projects" className="jua mr-2 flex items-center gap-2 text-2xl text-white">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--reward)" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z" />
            </svg>
            클래스보드
          </Link>
          <Link href="/projects" className={navLink}>
            프로젝트
          </Link>
          {me.role === "teacher" && (
            <>
              <Link href="/students" className={navLink}>
                학생 계정
              </Link>
              <Link href="/criteria" className={navLink}>
                평가 기준
              </Link>
            </>
          )}
          <span className="ml-auto truncate text-sm text-primary-soft" data-testid="me">
            <b className="text-white">{me.display_name}</b>
            {me.role === "student" ? ` (${me.login_id})` : " 선생님"}
          </span>
          <form action={signOut}>
            <button type="submit" className="btn-ghost min-h-10">
              로그아웃
            </button>
          </form>
        </nav>
      </header>
      <div className="flex w-full flex-1 flex-col">{children}</div>
    </>
  );
}
