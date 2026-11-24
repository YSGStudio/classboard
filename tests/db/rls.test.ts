/**
 * 권한·제약 통합 테스트(원격 Supabase, 시드 필요: npm run db:seed).
 * 테스트가 만든 프로젝트·파일·임시 학생은 afterAll에서 지운다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { issueStudents } from "@/lib/students-core";
import { BUCKET } from "@/lib/storage-cleanup";
import { TEST_PREFIX, admin, expectError, must, seed, signInStudent, signInTeacher } from "./helpers";

let ta: SupabaseClient; // 교사 A
let tb: SupabaseClient; // 교사 B
let s1: SupabaseClient; // 교사 A의 학생들
let s2: SupabaseClient;
let s3: SupabaseClient;
const S1 = seed.students[0].id;
const S2 = seed.students[1].id;
const S3 = seed.students[2].id;
const TA = seed.teachers.a.id;

let project: string;
const uploaded: string[] = [];
const tempUsers: string[] = [];

async function newBoard(fields: Record<string, unknown> = {}, client = ta, projectId = project) {
  return must(
    await client
      .from("boards")
      .insert({ project_id: projectId, title: `${TEST_PREFIX} 보드`, ...fields })
      .select("id")
      .single(),
  ).id as string;
}

async function firstColumns(board: string) {
  return must(await ta.from("columns").select("id, name").eq("board_id", board).order("position")) as {
    id: string;
    name: string;
  }[];
}

async function addCard(client: SupabaseClient, board: string, column: string, title = "카드") {
  return client.from("cards").insert({ board_id: board, column_id: column, title }).select("id").single();
}

async function view(client: SupabaseClient, board: string) {
  return must(await client.rpc("get_board_view", { p_board: board })) as {
    board: { locked: boolean; access: string; can_write: boolean };
    columns: { id: string; hidden_count: number; effective_hide: string }[];
    cards: { id: string; author_id: string | null; author_name: string | null; is_mine: boolean }[];
    criteria: { id: string }[];
  } | null;
}

beforeAll(async () => {
  [ta, tb, s1, s2, s3] = await Promise.all([
    signInTeacher("a"),
    signInTeacher("b"),
    signInStudent(0),
    signInStudent(1),
    signInStudent(2),
  ]);
  project = must(
    await ta.from("projects").insert({ teacher_id: TA, title: `${TEST_PREFIX} 프로젝트` }).select("id").single(),
  ).id;
});

afterAll(async () => {
  if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded);
  await admin.from("projects").delete().like("title", `${TEST_PREFIX}%`);
  for (const id of tempUsers) await admin.auth.admin.deleteUser(id);
});

describe("AC2 프로젝트 접근", () => {
  it("학생은 소속 교사 프로젝트만 본다", async () => {
    const ids = (must(await s1.from("projects").select("id")) as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(seed.projects.a);
    expect(ids).not.toContain(seed.projects.b);
    expect(must(await s1.from("projects").select("id").eq("id", seed.projects.b))).toHaveLength(0);
  });

  it("다른 교사는 프로젝트·보드를 보지도 만들지도 못한다", async () => {
    const board = await newBoard({ default_access: "edit" });
    expect(must(await tb.from("projects").select("id").eq("id", project))).toHaveLength(0);
    expect(must(await tb.from("boards").select("id").eq("id", board))).toHaveLength(0);
    expectError(await tb.from("boards").insert({ project_id: project, title: "침입" }));
    expect(await view(tb, board)).toBeNull();
  });

  it("학생은 프로젝트를 만들 수 없다", async () => {
    expectError(await s1.from("projects").insert({ teacher_id: TA, title: "학생 프로젝트" }));
  });
});

describe("AC3 보드 트리", () => {
  it("10단계 하위 보드를 만들고, 순환 이동은 거부한다", async () => {
    const chain: string[] = [await newBoard({ title: `${TEST_PREFIX} 0단계` })];
    for (let i = 1; i <= 10; i++) chain.push(await newBoard({ title: `${TEST_PREFIX} ${i}단계`, parent_id: chain[i - 1] }));
    const tree = must(await ta.rpc("get_board_tree", { p_project: project })) as { id: string }[];
    for (const id of chain) expect(tree.map((n) => n.id)).toContain(id);

    const msg = expectError(await ta.from("boards").update({ parent_id: chain[10] }).eq("id", chain[0]));
    expect(msg).toContain("BOARD_CYCLE");
    expect(expectError(await ta.from("boards").update({ parent_id: chain[3] }).eq("id", chain[3]))).toContain(
      "BOARD_CYCLE",
    );
  });

  it("순차형 프로젝트의 미개방 보드는 학생에게 잠긴다", async () => {
    const seq = must(
      await ta
        .from("projects")
        .insert({ teacher_id: TA, title: `${TEST_PREFIX} 순차형`, flow: "sequential" })
        .select("id")
        .single(),
    ).id;
    const board = await newBoard({ default_access: "edit" }, ta, seq);
    const [col] = await firstColumns(board);
    const v = await view(s1, board);
    expect(v?.board.locked).toBe(true);
    expect(v?.board.can_write).toBe(false);
    expectError(await addCard(s1, board, col.id));

    must(await ta.from("boards").update({ unlocked: true }).eq("id", board).select("id"));
    expect((await view(s1, board))?.board.locked).toBe(false);
    must(await addCard(s1, board, col.id));
  });
});

describe("AC4 열 개수", () => {
  it("기본 열 5개, 9번째 추가와 마지막 열 삭제를 거부한다", async () => {
    const board = await newBoard();
    const cols = await firstColumns(board);
    expect(cols.map((c) => c.name)).toEqual(["발산", "변환", "수렴", "실행", "완료"]);
    for (let i = 6; i <= 8; i++) must(await ta.from("columns").insert({ board_id: board, name: `열${i}`, position: i }));
    expect(expectError(await ta.from("columns").insert({ board_id: board, name: "열9", position: 9 }))).toContain(
      "COLUMN_LIMIT",
    );
    const all = await firstColumns(board);
    for (const c of all.slice(1)) must(await ta.from("columns").delete().eq("id", c.id));
    expect(expectError(await ta.from("columns").delete().eq("id", all[0].id))).toContain("COLUMN_LIMIT");
  });

  it("학생은 열을 바꿀 수 없다", async () => {
    const board = await newBoard({ default_access: "edit" });
    const [col] = await firstColumns(board);
    expectError(await s1.from("columns").insert({ board_id: board, name: "학생 열" }));
    expect(must(await s1.from("columns").update({ name: "바꿈" }).eq("id", col.id).select("id"))).toHaveLength(0);
  });
});

describe("AC18 보드 권한", () => {
  it("없음·읽기·수정이 학생별로 적용되고 회수하면 기본 권한으로 돌아간다", async () => {
    const board = await newBoard({ default_access: "none" });
    const [col] = await firstColumns(board);
    const inTree = async (c: SupabaseClient) =>
      ((must(await c.rpc("get_board_tree", { p_project: project })) as { id: string; accessible: boolean }[]) ?? []).some(
        (n) => n.id === board && n.accessible,
      );

    expect(must(await s1.from("boards").select("id").eq("id", board))).toHaveLength(0);
    expect(await inTree(s1)).toBe(false);
    expect(await view(s1, board)).toBeNull();

    must(await ta.from("board_permissions").insert({ board_id: board, student_id: S1, access: "read" }));
    expect(must(await s1.from("boards").select("id").eq("id", board))).toHaveLength(1);
    expect(await inTree(s1)).toBe(true);
    expectError(await addCard(s1, board, col.id));
    expect(await inTree(s2)).toBe(false);

    must(await ta.from("board_permissions").update({ access: "edit" }).eq("board_id", board).eq("student_id", S1));
    must(await addCard(s1, board, col.id));

    // 기본 권한을 읽기로: 권한 행이 없는 s2도 읽기
    must(await ta.from("boards").update({ default_access: "read" }).eq("id", board));
    expect(await inTree(s2)).toBe(true);
    expectError(await addCard(s2, board, col.id));

    // 개별 회수(none)는 기본 권한보다 우선
    must(await ta.from("board_permissions").upsert({ board_id: board, student_id: S2, access: "none" }));
    expect(await inTree(s2)).toBe(false);

    // 권한 행 삭제 → 기본 권한(read)
    must(await ta.from("board_permissions").delete().eq("board_id", board).eq("student_id", S1));
    expectError(await addCard(s1, board, col.id));
    expect(await inTree(s1)).toBe(true);
  });

  it("학생은 권한을 스스로 바꿀 수 없다", async () => {
    const board = await newBoard({ default_access: "none" });
    expectError(await s1.from("board_permissions").insert({ board_id: board, student_id: S1, access: "edit" }));
    expect(must(await s1.from("boards").update({ default_access: "edit" }).eq("id", board).select("id"))).toHaveLength(0);
  });

  it("다른 교사의 학생에게는 권한을 줄 수 없다", async () => {
    const board = await newBoard();
    const bProject = seed.projects.b;
    const bBoard = await newBoard({ title: `${TEST_PREFIX} B` }, tb, bProject);
    expectError(await tb.from("board_permissions").insert({ board_id: bBoard, student_id: S1, access: "edit" }));
    await admin.from("boards").delete().eq("id", bBoard);
    expect(board).toBeTruthy();
  });
});

describe("AC5·AC12 카드 권한과 활동 기록", () => {
  let board: string;
  let cols: { id: string }[];
  let card: string;

  beforeAll(async () => {
    board = await newBoard({ default_access: "edit" });
    cols = await firstColumns(board);
    card = must(await addCard(s1, board, cols[0].id, "s1 카드")).id;
  });

  it("다른 학생은 수정·이동·삭제할 수 없고 교사는 할 수 있다", async () => {
    expect(must(await s2.from("cards").update({ title: "남의 것" }).eq("id", card).select("id"))).toHaveLength(0);
    expect(must(await s2.from("cards").update({ column_id: cols[1].id }).eq("id", card).select("id"))).toHaveLength(0);
    expect(must(await s2.from("cards").delete().eq("id", card).select("id"))).toHaveLength(0);
    expect(must(await s1.from("cards").select("title").eq("id", card).single()).title).toBe("s1 카드");

    expect(must(await ta.from("cards").update({ title: "교사 수정" }).eq("id", card).select("id"))).toHaveLength(1);
  });

  it("남의 이름으로 카드를 만들 수 없다", async () => {
    expectError(await s2.from("cards").insert({ board_id: board, column_id: cols[0].id, title: "사칭", author_id: S1 }));
  });

  it("생성 1 + 이동 2 = 활동 기록 3행, 시간순", async () => {
    const c = must(await addCard(s1, board, cols[0].id, "활동")).id;
    must(await s1.from("cards").update({ column_id: cols[1].id }).eq("id", c));
    must(await s1.from("cards").update({ column_id: cols[2].id }).eq("id", c));
    const acts = must(await s1.rpc("get_card_activities", { p_card: c })) as {
      action: string;
      from_column: string | null;
      to_column: string | null;
    }[];
    expect(acts.map((a) => a.action)).toEqual(["create", "move", "move"]);
    expect(acts[1]).toMatchObject({ from_column: "발산", to_column: "변환" });
    expect(acts[2]).toMatchObject({ from_column: "변환", to_column: "수렴" });
  });
});

describe("AC8·AC9 가리기", () => {
  let board: string;
  let cols: { id: string }[];
  let mine: string;
  let other: string;

  beforeAll(async () => {
    board = await newBoard({ default_access: "edit" });
    cols = await firstColumns(board);
    other = must(await addCard(s1, board, cols[0].id, "s1 비밀")).id;
    mine = must(await addCard(s2, board, cols[0].id, "s2 내 것")).id;
  });

  const setMode = async (hide_mode: string, revealed = false) =>
    must(await ta.from("boards").update({ hide_mode, revealed }).eq("id", board));

  it("off: 모두 작성자와 함께 보인다", async () => {
    await setMode("off");
    const v = await view(s2, board);
    expect(v?.cards.find((c) => c.id === other)?.author_id).toBe(S1);
  });

  it("hidden: 다른 학생 카드는 응답·테이블 조회 모두에 없다", async () => {
    await setMode("hidden");
    const v = await view(s2, board);
    expect(v?.cards.map((c) => c.id)).toEqual([mine]);
    expect(v?.columns[0].hidden_count).toBe(0);
    expect(JSON.stringify(v)).not.toContain("s1 비밀");
    expect(must(await s2.from("cards").select("id").eq("id", other))).toHaveLength(0);
    expect(must(await s2.from("activities").select("id").eq("card_id", other))).toHaveLength(0);
    expect(await s2.rpc("get_card_activities", { p_card: other }).then((r) => r.data)).toBeNull();
  });

  it("count: 개수만 알려주고 내용은 없다", async () => {
    await setMode("count");
    const v = await view(s2, board);
    expect(v?.cards.map((c) => c.id)).toEqual([mine]);
    expect(v?.columns[0].hidden_count).toBe(1);
    expect(JSON.stringify(v)).not.toContain("s1 비밀");
  });

  it("anonymous: 내용은 보이지만 작성자는 비어 있다", async () => {
    await setMode("anonymous");
    const v = await view(s2, board);
    const c = v?.cards.find((x) => x.id === other);
    expect(c).toBeTruthy();
    expect(c?.author_id).toBeNull();
    expect(c?.author_name).toBeNull();
    expect(JSON.stringify(v)).not.toContain(S1);
    // 테이블 직접 조회로는 author_id가 드러나므로 막혀 있어야 한다
    expect(must(await s2.from("cards").select("id").eq("id", other))).toHaveLength(0);
  });

  it("열 단위로 가리기를 끌 수 있다", async () => {
    await setMode("hidden");
    must(await ta.from("columns").update({ hide_applies: false }).eq("id", cols[0].id));
    expect((await view(s2, board))?.cards.map((c) => c.id)).toContain(other);
    must(await ta.from("columns").update({ hide_applies: true }).eq("id", cols[0].id));
  });

  it("모두 공개 → 다시 가리기", async () => {
    await setMode("hidden", true);
    expect((await view(s2, board))?.cards.find((c) => c.id === other)?.author_id).toBe(S1);
    await setMode("hidden", false);
    expect((await view(s2, board))?.cards.map((c) => c.id)).toEqual([mine]);
  });

  it("교사는 항상 모두 본다", async () => {
    await setMode("hidden");
    expect((await view(ta, board))?.cards).toHaveLength(2);
  });

  it("실시간 신호(board_events)에는 내용이 없다", async () => {
    const rows = must(await s2.from("board_events").select("*").eq("board_id", board)) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["board_id", "changed_at", "project_id", "scope"]);
    expect(must(await tb.from("board_events").select("*").eq("board_id", board))).toHaveLength(0);
  });
});

describe("AC10 개인 하위 보드", () => {
  let parent: string;

  beforeAll(async () => {
    parent = await newBoard({ default_access: "read", title: `${TEST_PREFIX} 개인 보드 부모` });
  });

  it("30명 배당이 10초 안에 끝나고 본인 것만 접근한다", async () => {
    const t0 = Date.now();
    const n = must(await ta.rpc("create_personal_boards", { p_parent: parent }));
    const elapsed = Date.now() - t0;
    console.log(`create_personal_boards(30): ${elapsed}ms`);
    expect(n).toBe(30);
    expect(elapsed).toBeLessThan(10_000);

    const all = must(await ta.from("boards").select("id, owner_id").eq("parent_id", parent).eq("kind", "personal")) as {
      id: string;
      owner_id: string;
    }[];
    expect(all).toHaveLength(30);
    expect(must(await ta.from("columns").select("id").eq("board_id", all[0].id))).toHaveLength(5);

    const seen = must(await s1.from("boards").select("id, owner_id").eq("parent_id", parent)) as { owner_id: string }[];
    expect(seen).toHaveLength(1);
    expect(seen[0].owner_id).toBe(S1);

    const mineBoard = all.find((b) => b.owner_id === S1)!.id;
    const otherBoard = all.find((b) => b.owner_id === S2)!.id;
    const [col] = (must(await s1.from("columns").select("id").eq("board_id", mineBoard)) as { id: string }[]);
    must(await addCard(s1, mineBoard, col.id));
    expect(await view(s1, otherBoard)).toBeNull();

    // 학생은 배당 함수를 쓸 수 없다
    expectError(await s1.rpc("create_personal_boards", { p_parent: parent }));
  });

  it("부모 보드는 계속 칸반으로 쓴다", async () => {
    const [col] = await firstColumns(parent);
    must(await addCard(ta, parent, col.id, "부모 카드"));
    expect((await view(s1, parent))?.cards.map((c) => c.id).length).toBeGreaterThan(0);
  });

  it("31번째 학생에게도 자동으로 만들어진다", async () => {
    const res = await issueStudents(admin, TA, [{ login_id: "rlstmp31", display_name: "임시 31" }], process.env.STUDENT_PASSWORD_PEPPER!);
    if (!res.ok) throw new Error(res.errors.join("\n"));
    tempUsers.push(res.students[0].id);
    const rows = must(
      await ta.from("boards").select("id").eq("parent_id", parent).eq("owner_id", res.students[0].id),
    );
    expect(rows).toHaveLength(1);
  });

  it("교사용 학생별 보기의 개수가 DB와 같다", async () => {
    const sum = must(await ta.rpc("get_board_student_summary", { p_board: parent })) as {
      students: { id: string; personal_count: number | null; personal_board_id: string | null }[];
    };
    const st = sum.students.find((s) => s.id === S1)!;
    expect(st.personal_board_id).toBeTruthy();
    const { count } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("board_id", st.personal_board_id!);
    expect(st.personal_count).toBe(count);
    expectError(await s1.rpc("get_board_student_summary", { p_board: parent }));
  });
});

describe("AC13·AC15·AC16 평가 기준과 평가", () => {
  const levels = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `단계${i + 1}`, score: i + 1 }));
  let board: string;
  let crit: string;

  beforeAll(async () => {
    board = await newBoard({ default_access: "read" });
  });

  it("단계 1개·6개는 거부, 2~5개는 허용", async () => {
    expectError(await ta.from("criteria").insert({ name: `${TEST_PREFIX} 1단계`, levels: levels(1) }));
    expectError(await ta.from("criteria").insert({ name: `${TEST_PREFIX} 6단계`, levels: levels(6) }));
    crit = must(await ta.from("criteria").insert({ name: `${TEST_PREFIX} 기준`, levels: levels(3) }).select("id").single()).id;
    must(await ta.from("board_criteria").insert({ board_id: board, criterion_id: crit }));
    expectError(await s1.from("criteria").insert({ name: "학생 기준", levels: levels(3) }));
  });

  it("미리 보여주기가 꺼지면 학생은 기준을 읽지 못하고, 켜면 하위 보드에서도 보인다", async () => {
    expect(must(await s1.from("criteria").select("id").eq("id", crit))).toHaveLength(0);
    expect((await view(s1, board))?.criteria).toHaveLength(0);
    must(await ta.from("boards").update({ show_criteria: true }).eq("id", board));
    expect(must(await s1.from("criteria").select("id").eq("id", crit))).toHaveLength(1);

    const child = must(await ta.rpc("create_personal_boards", { p_parent: board, p_students: [S1] }));
    expect(child).toBe(1);
    const personal = must(await s1.from("boards").select("id").eq("parent_id", board).single()).id;
    expect((await view(s1, personal))?.criteria.map((c) => c.id)).toEqual([crit]);
    must(await ta.from("boards").update({ show_criteria: false }).eq("id", board));
    expect(must(await tb.from("criteria").select("id").eq("id", crit))).toHaveLength(0);
  });

  it("공개 전 0건, 공개 후 본인 것 1건만", async () => {
    const ev = must(
      await ta
        .from("evaluations")
        .insert({ board_id: board, student_id: S1, levels: { [crit]: 2 }, feedback: "잘함" })
        .select("id")
        .single(),
    ).id;
    expectError(await ta.from("evaluations").insert({ board_id: board, student_id: S1, levels: {} }));
    expect(must(await s1.from("evaluations").select("id"))).toHaveLength(0);

    must(await ta.from("evaluations").update({ published: true }).eq("id", ev));
    expect(must(await s1.from("evaluations").select("id").eq("board_id", board))).toHaveLength(1);
    expect(must(await s2.from("evaluations").select("id").eq("board_id", board))).toHaveLength(0);
    expect(must(await s3.from("evaluations").select("id").eq("id", ev))).toHaveLength(0);
    expect(must(await tb.from("evaluations").select("id").eq("id", ev))).toHaveLength(0);
    // 공개된 평가가 쓰는 기준은 미리 보여주기와 상관없이 본인이 읽을 수 있다
    expect(must(await s1.from("criteria").select("id").eq("id", crit))).toHaveLength(1);
    expect(must(await s2.from("criteria").select("id").eq("id", crit))).toHaveLength(0);
    expect(must(await s1.from("evaluations").update({ feedback: "조작" }).eq("id", ev).select("id"))).toHaveLength(0);
  });

  it("평가가 있는 기준은 단계 수정·삭제를 거부하고, 복사는 새 행이다", async () => {
    expect(expectError(await ta.from("criteria").update({ levels: levels(4) }).eq("id", crit))).toContain(
      "CRITERION_LOCKED",
    );
    expect(expectError(await ta.from("criteria").delete().eq("id", crit))).toContain("CRITERION_LOCKED");
    must(await ta.from("criteria").update({ name: `${TEST_PREFIX} 기준(이름만)` }).eq("id", crit));
    const copy = must(
      await ta
        .from("criteria")
        .insert({ name: `${TEST_PREFIX} 기준 사본`, levels: levels(4), source_criterion_id: crit })
        .select("id")
        .single(),
    ).id;
    expect(copy).not.toBe(crit);
  });
});

describe("AC19 첨부 파일 Storage", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  it("권한 있는 학생만 올리고 읽는다", async () => {
    const board = await newBoard({ default_access: "edit", hide_mode: "hidden" });
    const [col] = await firstColumns(board);
    const card = must(await addCard(s1, board, col.id, "첨부")).id;
    const path = `${board}/${card}/a.png`;

    must(await s1.storage.from(BUCKET).upload(path, png, { contentType: "image/png" }));
    uploaded.push(path);
    must(await s1.from("attachments").insert({ card_id: card, type: "image", name: "a.png", storage_path: path, size: png.length }));

    expect((await s1.storage.from(BUCKET).download(path)).error).toBeNull();
    expect((await ta.storage.from(BUCKET).download(path)).error).toBeNull();
    expect((await s2.storage.from(BUCKET).download(path)).error).not.toBeNull(); // 가리기 중
    expect((await tb.storage.from(BUCKET).download(path)).error).not.toBeNull();
    expect(must(await s2.from("attachments").select("id").eq("card_id", card))).toHaveLength(0);

    // 남의 카드 경로에 올리기, 보드 경로 위조
    expect((await s2.storage.from(BUCKET).upload(`${board}/${card}/x.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    const s2card = must(await addCard(s2, board, col.id, "s2 첨부")).id;
    const otherBoard = await newBoard({ default_access: "edit" });
    expect(
      (await s2.storage.from(BUCKET).upload(`${otherBoard}/${s2card}/x.png`, png, { contentType: "image/png" })).error,
    ).not.toBeNull();

    // 가리기를 풀면 읽을 수 있다
    must(await ta.from("boards").update({ hide_mode: "off" }).eq("id", board));
    expect((await s2.storage.from(BUCKET).download(path)).error).toBeNull();

    // 접근 권한이 없는 학생
    must(await ta.from("board_permissions").insert({ board_id: board, student_id: S3, access: "none" }));
    expect((await s3.storage.from(BUCKET).download(path)).error).not.toBeNull();
  });
});
