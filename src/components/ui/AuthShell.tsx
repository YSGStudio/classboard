export function AuthShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="overflow-hidden rounded-[20px] bg-card shadow-[0_4px_0_var(--shadow)]">
        <div className="flex flex-col gap-1 bg-primary px-6 py-6 text-white">
          <span className="text-sm text-primary-soft">{subtitle}</span>
          <h1 className="flex items-center gap-2 text-4xl">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--reward)" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L2.9 9.4l6.3-.9z" />
            </svg>
            클래스보드
          </h1>
        </div>
        <div className="flex flex-col gap-5 p-6">{children}</div>
      </div>
    </main>
  );
}
