export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export function friendlyDbError(message: string | undefined): string {
  if (!message) return "알 수 없는 오류가 발생했습니다.";
  if (message.includes("COLUMN_LIMIT")) {
    return message.includes("at most") ? "열은 최대 60개까지 만들 수 있습니다." : "열은 최소 1개가 있어야 합니다.";
  }
  if (message.includes("BOARD_CYCLE")) return "보드를 자기 자신이나 하위 보드 아래로 옮길 수 없습니다.";
  if (message.includes("CRITERION_LOCKED")) return "평가가 있는 기준은 단계를 바꾸거나 지울 수 없습니다. '복사해서 수정'을 쓰세요.";
  if (message.includes("row-level security") || message.includes("permission denied")) return "권한이 없습니다.";
  if (message.includes("valid_levels")) return "단계는 2~5개여야 합니다.";
  if (message.includes("duplicate key")) return "이미 있는 항목입니다.";
  return message;
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
