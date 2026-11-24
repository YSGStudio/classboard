import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, MAX_COLUMNS, canAddColumn, canDeleteColumn, positionBetween } from "@/lib/columns";

describe("열 개수 제한", () => {
  it("기본 열은 발산·변환·수렴·실행·완료 5개", () => {
    expect(DEFAULT_COLUMNS.map((c) => c.name)).toEqual(["발산", "변환", "수렴", "실행", "완료"]);
  });
  it("8개까지만 추가, 9번째는 거부", () => {
    expect(canAddColumn(7)).toBe(true);
    expect(canAddColumn(MAX_COLUMNS)).toBe(false);
  });
  it("마지막 1개는 삭제 거부", () => {
    expect(canDeleteColumn(2)).toBe(true);
    expect(canDeleteColumn(1)).toBe(false);
  });
  it("분수 위치", () => {
    expect(positionBetween(null, null)).toBe(1);
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(3, null)).toBe(4);
    expect(positionBetween(null, 1)).toBe(0);
  });
});
