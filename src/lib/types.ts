import type { HideMode } from "./hiding";
import type { Criterion } from "./criteria";
import type { CardField, CardFieldValues } from "./card-fields";

export type Role = "teacher" | "student";
export type Access = "none" | "read" | "edit";

export type Profile = {
  id: string;
  role: Role;
  display_name: string;
  login_id: string | null;
  teacher_id: string | null;
  active: boolean;
};

export type Project = {
  id: string;
  teacher_id: string;
  title: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  flow: "sequential" | "parallel";
  archived_at: string | null;
  created_at: string;
};

export type TreeNode = {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  kind: "shared" | "personal";
  owner_id: string | null;
  accessible: boolean;
  locked: boolean;
  access: Access | "teacher";
};

export type ColumnView = {
  id: string;
  name: string;
  stage: string | null;
  position: number;
  color: string;
  hide_applies: boolean;
  /** 이 섹션의 주인 학생(멤버별 섹션·개인 보드 섹션) */
  member_id?: string | null;
  effective_hide: HideMode;
  hidden_count: number;
};

export type AttachmentView = {
  id: string;
  type: "image" | "pdf" | "link";
  name: string;
  storage_path: string | null;
  thumb_path: string | null;
  url: string | null;
  size: number | null;
  page_count: number | null;
  preview: {
    title: string | null;
    description: string | null;
    image_url: string | null;
    site_name: string | null;
    ok: boolean;
  } | null;
};

export type ChecklistItem = { text: string; done: boolean };

export type CardView = {
  id: string;
  column_id: string;
  title: string;
  body: string;
  /** 보드 카드 형식의 항목별 값 */
  fields?: CardFieldValues;
  labels: string[];
  due_date: string | null;
  checklist: ChecklistItem[];
  position: number;
  created_at: string;
  updated_at: string;
  is_mine: boolean;
  author_id: string | null;
  author_name: string | null;
  author_login?: string | null;
  author_role?: "teacher" | "student" | null;
  can_edit: boolean;
  attachments: AttachmentView[];
};

export type BoardInfo = {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  kind: "shared" | "personal";
  owner_id: string | null;
  owner_name: string | null;
  default_access: Access | null;
  hide_mode: HideMode;
  revealed: boolean;
  show_criteria: boolean;
  unlocked: boolean;
  auto_personal: boolean;
  /** 카드 형식 (빈 배열 = 기본: 제목 + 내용). 개인 보드는 부모 작업장 것 */
  card_fields?: CardField[];
  /** 평가 작업장에서 학생끼리 평가하기 */
  peer_review?: boolean;
  /** 지금 보고 있는 사람 */
  viewer_id?: string | null;
  locked: boolean;
  access: Access | "teacher";
  can_write: boolean;
  evaluation_board_id: string;
  has_personal_children: boolean;
};

export type BoardView = {
  board: BoardInfo;
  columns: ColumnView[];
  cards: CardView[];
  criteria: Criterion[];
  my_evaluation: {
    levels: Record<string, number>;
    feedback: string;
    updated_at: string;
    criteria: Criterion[];
  } | null;
};

export type Activity = {
  id: number;
  action: "create" | "update" | "move" | "delete";
  created_at: string;
  actor_name: string | null;
  from_column: string | null;
  to_column: string | null;
};
