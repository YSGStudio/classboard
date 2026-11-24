import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { GoogleLoginButton } from "./GoogleLoginButton";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell subtitle="교사 로그인">
      {error && <p className="alert-error">로그인에 실패했습니다. 다시 시도해 주세요.</p>}
      <GoogleLoginButton />
      <p className="text-sm text-muted">
        학생인가요?{" "}
        <Link href="/student-login" className="font-bold text-primary underline underline-offset-4">
          학생 로그인
        </Link>
      </p>
    </AuthShell>
  );
}
