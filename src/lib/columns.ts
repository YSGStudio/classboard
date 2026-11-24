export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 8;

export const DEFAULT_COLUMNS = [
  { name: "발산", color: "#d97706" },
  { name: "변환", color: "#0284c7" },
  { name: "수렴", color: "#7c3aed" },
  { name: "실행", color: "#059669" },
  { name: "완료", color: "#475569" },
] as const;

export function canAddColumn(count: number): boolean {
  return count < MAX_COLUMNS;
}

export function canDeleteColumn(count: number): boolean {
  return count > MIN_COLUMNS;
}

/** 두 위치 사이의 새 위치(분수 위치). 끝에 넣을 때는 next=null */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1;
  if (prev === null) return next! - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}
