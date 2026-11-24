export const MAX_FAILURES = 5;
export const LOCK_MS = 5 * 60 * 1000;

export type LockState = { failed_count: number; locked_until: string | null };

export function isLocked(state: LockState | null, now: Date): boolean {
  return !!state?.locked_until && new Date(state.locked_until).getTime() > now.getTime();
}

/** 실패 1회를 반영한 다음 상태. 5회째 실패하면 5분 잠그고 카운트를 0으로 돌린다. */
export function nextStateAfterFailure(state: LockState | null, now: Date): LockState {
  const base = state && !isLocked(state, now) ? state.failed_count : 0;
  const count = base + 1;
  if (count >= MAX_FAILURES) {
    return { failed_count: 0, locked_until: new Date(now.getTime() + LOCK_MS).toISOString() };
  }
  return { failed_count: count, locked_until: null };
}
