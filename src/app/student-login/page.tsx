import Link from "next/link";
import { AuthShell } from "@/components/ui/AuthShell";
import { StudentLoginForm } from "./StudentLoginForm";

export default function StudentLoginPage() {
  return (
    <AuthShell subtitle="학생 로그인">
      <StudentLoginForm />
      <p className="text-sm text-muted">
        <Link href="/login" className="font-bold text-primary underline underline-offset-4">
          교사 로그인
        </Link>
      </p>
    </AuthShell>
  );
}
