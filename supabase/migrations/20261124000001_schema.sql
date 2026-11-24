-- 수업용 계층형 칸반 보드: 전체 스키마
-- 권한은 모두 여기(RLS·security definer 함수·Storage 정책)에서 강제한다.

create extension if not exists pgcrypto with schema extensions;

------------------------------------------------------------------------------
-- 테이블
------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('teacher', 'student')),
  display_name text not null default '',
  login_id text unique check (login_id ~ '^[a-z0-9_]{3,20}$'),
  teacher_id uuid references public.profiles (id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (role = 'teacher' and teacher_id is null and login_id is null)
    or (role = 'student' and teacher_id is not null and login_id is not null)
  )
);
create index on public.profiles (teacher_id);

create table public.login_attempts (
  login_id text primary key,
  failed_count int not null default 0,
  locked_until timestamptz
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  goal text not null default '' check (char_length(goal) <= 2000),
  start_date date,
  end_date date,
  flow text not null default 'parallel' check (flow in ('sequential', 'parallel')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index on public.projects (teacher_id);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.boards (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  position double precision not null default 0,
  kind text not null default 'shared' check (kind in ('shared', 'personal')),
  owner_id uuid references public.profiles (id) on delete cascade,
  default_access text not null default 'none' check (default_access in ('none', 'read', 'edit')),
  hide_mode text not null default 'off' check (hide_mode in ('off', 'hidden', 'count', 'anonymous')),
  -- "모두 공개" 상태. true이면 hide_mode를 유지한 채 가리기를 끈다("다시 가리기"는 false로).
  revealed boolean not null default false,
  show_criteria boolean not null default false,
  unlocked boolean not null default false,
  -- "학생별 개인 보드 만들기"를 전체 학생으로 실행한 보드: 나중에 등록된 학생에게도 자동 생성
  auto_personal boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'personal') = (owner_id is not null)),
  check (kind = 'shared' or parent_id is not null)
);
create index on public.boards (project_id);
create index on public.boards (parent_id);
create unique index boards_one_personal_per_student on public.boards (parent_id, owner_id) where kind = 'personal';

create table public.board_permissions (
  board_id uuid not null references public.boards (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  access text not null check (access in ('none', 'read', 'edit')),
  primary key (board_id, student_id)
);
create index on public.board_permissions (student_id);

create table public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  stage text,
  position double precision not null default 0,
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- 이 열에 보드의 가리기 방식을 적용할지
  hide_applies boolean not null default true
);
create index on public.columns (board_id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  column_id uuid not null references public.columns (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  body text not null default '' check (char_length(body) <= 2000),
  labels text[] not null default '{}' check (cardinality(labels) <= 10),
  due_date date,
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.cards (board_id);
create index on public.cards (column_id);
create index on public.cards (author_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  type text not null check (type in ('image', 'pdf', 'link')),
  name text not null default '' check (char_length(name) <= 255),
  storage_path text,
  thumb_path text,
  url text,
  size bigint,
  page_count int,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (type = 'image' and storage_path is not null and size between 1 and 10485760)
    or (type = 'pdf' and storage_path is not null and size between 1 and 20971520)
    or (type = 'link' and url ~* '^https?://' and char_length(url) <= 2048)
  )
);
create index on public.attachments (card_id);

create table public.link_previews (
  url_hash text primary key,
  url text not null,
  title text,
  description text,
  image_url text,
  site_name text,
  ok boolean not null default false,
  fetched_at timestamptz not null default now()
);

-- card_id는 삭제 기록을 남기기 위해 FK를 두지 않는다
create table public.activities (
  id bigint generated always as identity primary key,
  board_id uuid not null references public.boards (id) on delete cascade,
  card_id uuid not null,
  card_title text not null default '',
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('create', 'update', 'move', 'delete')),
  from_column uuid,
  to_column uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.activities (card_id, created_at);
create index on public.activities (board_id);

-- 실시간 알림 전용. 내용은 담지 않는다(board_id, 시각, 범위만).
create table public.board_events (
  board_id uuid primary key references public.boards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  scope text not null default 'content' check (scope in ('content', 'structure')),
  changed_at timestamptz not null default clock_timestamp()
);
create index on public.board_events (project_id);

create or replace function public.valid_levels(l jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(l) = 'array'
    and jsonb_array_length(l) between 2 and 5
    and not exists (
      select 1 from jsonb_array_elements(l) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'name') <> 'string'
         or char_length(btrim(e ->> 'name')) not between 1 and 40
         or jsonb_typeof(e -> 'score') <> 'number'
         or (e ? 'description' and jsonb_typeof(e -> 'description') <> 'string')
    )
$$;

create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 1000),
  levels jsonb not null check (public.valid_levels(levels)),
  source_criterion_id uuid references public.criteria (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.criteria (teacher_id);

create table public.board_criteria (
  board_id uuid not null references public.boards (id) on delete cascade,
  criterion_id uuid not null references public.criteria (id) on delete cascade,
  position double precision not null default 0,
  primary key (board_id, criterion_id)
);
create index on public.board_criteria (criterion_id);

-- levels: {"<criterion_id>": <선택한 단계 index>}
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  levels jsonb not null default '{}' check (jsonb_typeof(levels) = 'object'),
  feedback text not null default '' check (char_length(feedback) <= 2000),
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (board_id, student_id)
);
create index on public.evaluations (student_id);

------------------------------------------------------------------------------
-- 권한 계산 함수 (security definer: RLS 재귀 없이 계산)
------------------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- 교사는 자기 id, 학생은 발급 교사 id
create or replace function public.group_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select case when role = 'teacher' then id else teacher_id end
  from profiles where id = auth.uid() and active
$$;

create or replace function public.is_project_teacher(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr join profiles me on me.id = auth.uid()
    where pr.id = p and pr.teacher_id = me.id and me.role = 'teacher' and me.active
  )
$$;

create or replace function public.is_board_teacher(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from boards bo
    join projects pr on pr.id = bo.project_id
    join profiles me on me.id = auth.uid()
    where bo.id = b and pr.teacher_id = me.id and me.role = 'teacher' and me.active
  )
$$;

-- 학생의 보드 접근 수준: none / read / edit
-- 1) 프로젝트 교사가 내 교사가 아니면(또는 보관됨) none
-- 2) board_permissions 행이 있으면 그 값
-- 3) 개인 보드의 owner면 edit
-- 4) 아니면 default_access
create or replace function public.student_access(b uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_me profiles;
  v_board boards;
  v_teacher uuid;
  v_archived timestamptz;
  v_perm text;
begin
  select * into v_me from profiles where id = auth.uid();
  if v_me.id is null or v_me.role <> 'student' or not v_me.active then
    return 'none';
  end if;
  select * into v_board from boards where id = b;
  if v_board.id is null then
    return 'none';
  end if;
  select teacher_id, archived_at into v_teacher, v_archived from projects where id = v_board.project_id;
  if v_teacher is distinct from v_me.teacher_id or v_archived is not null then
    return 'none';
  end if;
  select access into v_perm from board_permissions where board_id = b and student_id = v_me.id;
  if found then
    return v_perm;
  end if;
  if v_board.kind = 'personal' and v_board.owner_id = v_me.id then
    return 'edit';
  end if;
  return v_board.default_access;
end $$;

-- 순차형 프로젝트에서 교사가 열지 않은 공용 보드
create or replace function public.board_locked(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select bo.kind = 'shared' and pr.flow = 'sequential' and not bo.unlocked
    from boards bo join projects pr on pr.id = bo.project_id where bo.id = b
  ), false)
$$;

create or replace function public.can_read_board(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_board_teacher(b) or public.student_access(b) in ('read', 'edit')
$$;

create or replace function public.can_edit_board(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_board_teacher(b)
      or (public.student_access(b) = 'edit' and not public.board_locked(b))
$$;

-- 열에 실제로 적용되는 가리기 방식(학생 기준). 개인 보드·공개 중·적용 안 한 열은 off
create or replace function public.column_hide_mode(col uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when bo.kind = 'personal' or bo.revealed or not c.hide_applies then 'off'
    else bo.hide_mode end
  from columns c join boards bo on bo.id = c.board_id
  where c.id = col
$$;

-- 카드 내용을 읽을 수 있는가(익명 모드 포함). 첨부·Storage 정책에 쓴다.
create or replace function public.can_read_card(card uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when public.is_board_teacher(c.board_id) then true
      when public.student_access(c.board_id) = 'none' or public.board_locked(c.board_id) then false
      when c.author_id = auth.uid() then true
      else public.column_hide_mode(c.column_id) in ('off', 'anonymous')
    end
    from cards c where c.id = card
  ), false)
$$;

create or replace function public.can_write_card(card uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.is_board_teacher(c.board_id)
        or (c.author_id = auth.uid() and public.student_access(c.board_id) = 'edit'
            and not public.board_locked(c.board_id))
    from cards c where c.id = card
  ), false)
$$;

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- 평가 기준이 붙는 보드: 개인 하위 보드는 부모 보드
create or replace function public.evaluation_board(b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when kind = 'personal' then parent_id else id end from boards where id = b
$$;

create or replace function public.can_read_criterion(cr uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from criteria where id = cr and teacher_id = auth.uid() and public.my_role() = 'teacher')
  or exists (
    -- 미리 보여주기가 켜진 보드에 붙어 있고, 그 보드(또는 그 보드의 내 개인 하위 보드)를 읽을 수 있음
    select 1 from board_criteria bc join boards bo on bo.id = bc.board_id
    where bc.criterion_id = cr and bo.show_criteria
      and (
        public.student_access(bo.id) in ('read', 'edit')
        or exists (select 1 from boards pb where pb.parent_id = bo.id and pb.kind = 'personal'
                   and pb.owner_id = auth.uid() and public.student_access(pb.id) in ('read', 'edit'))
      )
  )
  or exists (
    -- 나에게 공개된 평가가 이 기준을 쓰고 있음
    select 1 from evaluations e
    where e.student_id = auth.uid() and e.published and e.levels ? cr::text
      and public.my_role() = 'student'
  )
$$;

------------------------------------------------------------------------------
-- 트리거
------------------------------------------------------------------------------

-- 실시간 신호
create or replace function public.touch_board(b uuid, s text default 'content') returns void
language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from boards where id = b;
  if v_project is null then
    return;
  end if;
  insert into board_events (board_id, project_id, scope, changed_at)
  values (b, v_project, s, clock_timestamp())
  on conflict (board_id) do update set scope = excluded.scope, changed_at = excluded.changed_at;
end $$;

-- auth.users 생성 시 profiles 생성
-- 학생: 서버(service role)가 app_metadata에 role/login_id/teacher_id/display_name을 넣어 만든다.
-- 교사: 구글 OAuth로 처음 들어온 사용자. (테스트 시드는 app_metadata.role=teacher)
-- 그 외(예: 이메일 직접 가입)는 profiles가 없어 아무 데이터에도 접근하지 못한다.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := new.raw_app_meta_data ->> 'role';
begin
  if r = 'student' then
    insert into profiles (id, role, display_name, login_id, teacher_id)
    values (new.id, 'student',
            coalesce(new.raw_app_meta_data ->> 'display_name', ''),
            new.raw_app_meta_data ->> 'login_id',
            (new.raw_app_meta_data ->> 'teacher_id')::uuid);
  elsif r = 'teacher' or new.raw_app_meta_data ->> 'provider' = 'google' then
    insert into profiles (id, role, display_name)
    values (new.id, 'teacher',
            coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.profiles_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'student' and not exists (select 1 from profiles where id = new.teacher_id and role = 'teacher') then
    raise exception 'teacher_id must reference a teacher' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.role <> old.role or new.teacher_id is distinct from old.teacher_id
                           or new.login_id is distinct from old.login_id) then
    raise exception 'role, teacher_id, login_id are immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_check before insert or update on public.profiles
for each row execute function public.profiles_check();

create or replace function public.projects_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.teacher_id and role = 'teacher') then
    raise exception 'project teacher must be a teacher' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.teacher_id <> old.teacher_id then
    raise exception 'teacher_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger projects_check before insert or update on public.projects
for each row execute function public.projects_check();

-- 보드 트리: 같은 프로젝트, 순환 금지, 기본값 복사
create or replace function public.boards_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_parent boards;
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.kind <> old.kind or new.owner_id is distinct from old.owner_id then
      raise exception 'project_id, kind, owner_id are immutable' using errcode = '42501';
    end if;
    if old.kind = 'personal' and new.parent_id is distinct from old.parent_id then
      raise exception 'personal boards cannot be moved' using errcode = '42501';
    end if;
  end if;

  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'BOARD_CYCLE: a board cannot be its own parent' using errcode = '23514';
    end if;
    select * into v_parent from boards where id = new.parent_id;
    if v_parent.id is null or v_parent.project_id <> new.project_id then
      raise exception 'parent board must be in the same project' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id and exists (
      with recursive anc as (
        select id, parent_id from boards where id = new.parent_id
        union all
        select b.id, b.parent_id from boards b join anc on b.id = anc.parent_id
      ) select 1 from anc where id = new.id
    ) then
      raise exception 'BOARD_CYCLE: cannot move a board under its own descendant' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'personal' then
      new.default_access := 'none';
      new.hide_mode := 'off';
      new.unlocked := true;
    elsif v_parent.id is not null then
      -- 새 하위 보드는 부모의 기본 권한을 복사해 시작한다
      new.default_access := v_parent.default_access;
    end if;
  end if;
  return new;
end $$;

create trigger boards_before before insert or update on public.boards
for each row execute function public.boards_before();

create or replace function public.boards_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_parent boards;
begin
  if tg_op = 'INSERT' then
    select * into v_parent from boards where id = new.parent_id;
    if new.kind = 'personal' then
      insert into columns (board_id, name, stage, position, color, hide_applies)
      select new.id, name, stage, position, color, hide_applies from columns where board_id = new.parent_id;
    else
      insert into columns (board_id, name, stage, position, color) values
        (new.id, '발산', '발산', 1, '#d97706'),
        (new.id, '변환', '변환', 2, '#0284c7'),
        (new.id, '수렴', '수렴', 3, '#7c3aed'),
        (new.id, '실행', '실행', 4, '#059669'),
        (new.id, '완료', '완료', 5, '#475569');
      if v_parent.id is not null then
        insert into board_permissions (board_id, student_id, access)
        select new.id, student_id, access from board_permissions where board_id = v_parent.id;
        if v_parent.kind = 'personal' then
          -- 개인 보드 아래 하위 보드: 주인 학생은 계속 수정할 수 있다
          insert into board_permissions (board_id, student_id, access)
          values (new.id, v_parent.owner_id, 'edit')
          on conflict (board_id, student_id) do update set access = 'edit';
        end if;
      end if;
    end if;
    perform touch_board(new.id, 'structure');
    if new.parent_id is not null then
      perform touch_board(new.parent_id, 'structure');
    end if;
  elsif tg_op = 'UPDATE' then
    perform touch_board(new.id, 'structure');
  elsif tg_op = 'DELETE' then
    if old.parent_id is not null then
      perform touch_board(old.parent_id, 'structure');
    end if;
  end if;
  return null;
end $$;

create trigger boards_after after insert or update or delete on public.boards
for each row execute function public.boards_after();

-- 열 개수 1~8
create or replace function public.columns_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from boards where id = new.board_id for update;
    if (select count(*) from columns where board_id = new.board_id) >= 8 then
      raise exception 'COLUMN_LIMIT: a board can have at most 8 columns' using errcode = '23514';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- 보드 자체가 지워지는 중이면 허용
    if exists (select 1 from boards where id = old.board_id) then
      if (select count(*) from columns where board_id = old.board_id) <= 1 then
        raise exception 'COLUMN_LIMIT: a board must keep at least 1 column' using errcode = '23514';
      end if;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if new.board_id <> old.board_id then
      raise exception 'board_id is immutable' using errcode = '42501';
    end if;
    return new;
  end if;
  return null;
end $$;

create trigger columns_limit before insert or update or delete on public.columns
for each row execute function public.columns_limit();

create or replace function public.columns_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_board(coalesce(new.board_id, old.board_id), 'content');
  return null;
end $$;

create trigger columns_after after insert or update or delete on public.columns
for each row execute function public.columns_after();

-- 카드: 열·보드 일치, 작성자·보드 불변
create or replace function public.cards_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.author_id <> old.author_id or new.board_id <> old.board_id then
      raise exception 'author_id and board_id are immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if not exists (select 1 from columns where id = new.column_id and board_id = new.board_id) then
    raise exception 'column does not belong to board' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger cards_before before insert or update on public.cards
for each row execute function public.cards_before();

-- 활동 기록 + 실시간 신호
create or replace function public.cards_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activities (board_id, card_id, card_title, actor_id, action, to_column)
    values (new.board_id, new.id, new.title, auth.uid(), 'create', new.column_id);
    perform touch_board(new.board_id);
  elsif tg_op = 'UPDATE' then
    if new.column_id <> old.column_id then
      insert into activities (board_id, card_id, card_title, actor_id, action, from_column, to_column)
      values (new.board_id, new.id, new.title, auth.uid(), 'move', old.column_id, new.column_id);
    elsif (new.title, new.body, new.labels, new.due_date, new.checklist)
          is distinct from (old.title, old.body, old.labels, old.due_date, old.checklist) then
      insert into activities (board_id, card_id, card_title, actor_id, action, from_column, to_column)
      values (new.board_id, new.id, new.title, auth.uid(), 'update', new.column_id, new.column_id);
    end if;
    perform touch_board(new.board_id);
  elsif tg_op = 'DELETE' then
    if exists (select 1 from boards where id = old.board_id) then
      insert into activities (board_id, card_id, card_title, actor_id, action, from_column)
      values (old.board_id, old.id, old.title, auth.uid(), 'delete', old.column_id);
      perform touch_board(old.board_id);
    end if;
  end if;
  return null;
end $$;

create trigger cards_after after insert or update or delete on public.cards
for each row execute function public.cards_after();

create or replace function public.attachments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_board uuid;
begin
  select board_id into v_board from cards where id = coalesce(new.card_id, old.card_id);
  if v_board is not null then
    perform touch_board(v_board);
  end if;
  return null;
end $$;

create trigger attachments_after after insert or update or delete on public.attachments
for each row execute function public.attachments_after();

create or replace function public.board_permissions_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from boards bo join projects pr on pr.id = bo.project_id
    join profiles st on st.id = new.student_id
    where bo.id = new.board_id and st.role = 'student' and st.teacher_id = pr.teacher_id
  ) then
    raise exception 'student must belong to the project teacher' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger board_permissions_check before insert or update on public.board_permissions
for each row execute function public.board_permissions_check();

create or replace function public.board_permissions_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_board(coalesce(new.board_id, old.board_id), 'structure');
  return null;
end $$;

create trigger board_permissions_after after insert or update or delete on public.board_permissions
for each row execute function public.board_permissions_after();

-- 기준 잠금: 평가가 1건 이상이면 단계 수정·기준 삭제 거부
create or replace function public.criteria_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.teacher_id <> old.teacher_id then
      raise exception 'teacher_id is immutable' using errcode = '42501';
    end if;
    if new.levels is distinct from old.levels
       and exists (select 1 from evaluations where levels ? old.id::text) then
      raise exception 'CRITERION_LOCKED: criterion has evaluations; copy it to edit levels' using errcode = '23514';
    end if;
    return new;
  else
    if exists (select 1 from evaluations where levels ? old.id::text) then
      raise exception 'CRITERION_LOCKED: criterion has evaluations and cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;
end $$;

create trigger criteria_lock before update or delete on public.criteria
for each row execute function public.criteria_lock();

create or replace function public.board_criteria_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from criteria cr join boards bo on bo.id = new.board_id
    join projects pr on pr.id = bo.project_id
    where cr.id = new.criterion_id and cr.teacher_id = pr.teacher_id and bo.kind = 'shared'
  ) then
    raise exception 'criterion must belong to the board teacher and board must be shared' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger board_criteria_check before insert or update on public.board_criteria
for each row execute function public.board_criteria_check();

create or replace function public.board_criteria_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_board(coalesce(new.board_id, old.board_id));
  return null;
end $$;

create trigger board_criteria_after after insert or update or delete on public.board_criteria
for each row execute function public.board_criteria_after();

create or replace function public.evaluations_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.board_id <> old.board_id or new.student_id <> old.student_id) then
    raise exception 'board_id and student_id are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from boards bo join projects pr on pr.id = bo.project_id
    join profiles st on st.id = new.student_id
    where bo.id = new.board_id and bo.kind = 'shared' and st.role = 'student' and st.teacher_id = pr.teacher_id
  ) then
    raise exception 'evaluation must target a shared board and a student of its teacher' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger evaluations_before before insert or update on public.evaluations
for each row execute function public.evaluations_before();

create or replace function public.evaluations_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_board uuid := coalesce(new.board_id, old.board_id);
declare v_student uuid := coalesce(new.student_id, old.student_id);
declare v_personal uuid;
begin
  if tg_op = 'UPDATE' and new.published = old.published and not new.published then
    return null; -- 공개 전 자동 저장은 알릴 필요 없음
  end if;
  perform touch_board(v_board);
  select id into v_personal from boards where parent_id = v_board and kind = 'personal' and owner_id = v_student;
  if v_personal is not null then
    perform touch_board(v_personal);
  end if;
  return null;
end $$;

create trigger evaluations_after after insert or update or delete on public.evaluations
for each row execute function public.evaluations_after();

------------------------------------------------------------------------------
-- 개인 하위 보드 (R10)
------------------------------------------------------------------------------

create or replace function public._create_personal_board(p_parent uuid, p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_parent boards;
  v_student profiles;
  v_id uuid;
begin
  select * into v_parent from boards where id = p_parent;
  select * into v_student from profiles where id = p_student and role = 'student';
  if v_parent.id is null or v_student.id is null then
    return null;
  end if;
  select id into v_id from boards where parent_id = p_parent and kind = 'personal' and owner_id = p_student;
  if v_id is not null then
    return v_id;
  end if;
  insert into boards (project_id, parent_id, title, position, kind, owner_id)
  values (v_parent.project_id, p_parent,
          left(coalesce(nullif(v_student.display_name, ''), v_student.login_id), 100),
          (select count(*) from boards where parent_id = p_parent) + 1,
          'personal', p_student)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public._create_personal_board(uuid, uuid) from public, anon, authenticated;

-- p_students가 null이면 전체 학생 + 이후 등록 학생 자동 생성
create or replace function public.create_personal_boards(p_parent uuid, p_students uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_board boards;
  v_teacher uuid;
  v_count int := 0;
  v_student uuid;
begin
  if not public.is_board_teacher(p_parent) then
    raise exception 'only the project teacher can create personal boards' using errcode = '42501';
  end if;
  select * into v_board from boards where id = p_parent;
  if v_board.kind <> 'shared' then
    raise exception 'personal boards can only be created under a shared board' using errcode = '23514';
  end if;
  select teacher_id into v_teacher from projects where id = v_board.project_id;
  for v_student in
    select id from profiles
    where role = 'student' and teacher_id = v_teacher and active
      and (p_students is null or id = any (p_students))
    order by display_name, login_id
  loop
    perform public._create_personal_board(p_parent, v_student);
    v_count := v_count + 1;
  end loop;
  if p_students is null then
    update boards set auto_personal = true where id = p_parent;
  end if;
  return v_count;
end $$;

-- 나중에 등록된 학생에게도 개인 보드 자동 생성
create or replace function public.profiles_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_board uuid;
begin
  if new.role = 'student' then
    for v_board in
      select bo.id from boards bo join projects pr on pr.id = bo.project_id
      where bo.auto_personal and pr.teacher_id = new.teacher_id and pr.archived_at is null
    loop
      perform public._create_personal_board(v_board, new.id);
    end loop;
  end if;
  return null;
end $$;

create trigger profiles_after_insert after insert on public.profiles
for each row execute function public.profiles_after_insert();

------------------------------------------------------------------------------
-- 조회 함수
------------------------------------------------------------------------------

-- 프로젝트의 보드 트리. 접근 못 하는 상위 보드는 이름만(accessible=false)
create or replace function public.get_board_tree(p_project uuid)
returns table (id uuid, parent_id uuid, title text, "position" double precision, kind text,
               owner_id uuid, accessible boolean, locked boolean, access text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.is_project_teacher(p_project) then
    return query
      select b.id, b.parent_id, b.title, b.position, b.kind, b.owner_id, true, public.board_locked(b.id), 'teacher'::text
      from boards b where b.project_id = p_project;
    return;
  end if;
  return query
    with recursive vis as (
      select b.id, b.parent_id, public.student_access(b.id) as acc
      from boards b where b.project_id = p_project
    ),
    ok as (select v.id, v.parent_id, v.acc from vis v where v.acc <> 'none'),
    anc as (
      select o.parent_id as id from ok o where o.parent_id is not null
      union
      select b.parent_id from boards b join anc on b.id = anc.id where b.parent_id is not null
    )
    select b.id, b.parent_id, b.title, b.position, b.kind, b.owner_id,
           (o.id is not null), public.board_locked(b.id), coalesce(o.acc, 'none')
    from boards b
    left join ok o on o.id = b.id
    where b.id in (select ok.id from ok union select anc.id from anc);
end $$;

-- 보드 화면 데이터. 가리기 규칙을 적용해 학생에게 보이면 안 되는 데이터는 아예 담지 않는다.
create or replace function public.get_board_view(p_board uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_teacher boolean := public.is_board_teacher(p_board);
  v_access text;
  v_locked boolean;
  v_board boards;
  v_eval_board uuid;
  v_show_criteria boolean;
  v_owner_name text;
  v_result jsonb;
begin
  if v_teacher then
    v_access := 'teacher';
  else
    v_access := public.student_access(p_board);
    if v_access = 'none' then
      return null;
    end if;
  end if;
  select * into v_board from boards where id = p_board;
  v_locked := public.board_locked(p_board);
  v_eval_board := public.evaluation_board(p_board);
  select show_criteria into v_show_criteria from boards where id = v_eval_board;
  select display_name into v_owner_name from profiles where id = v_board.owner_id;

  select jsonb_build_object(
    'board', jsonb_build_object(
      'id', v_board.id, 'project_id', v_board.project_id, 'parent_id', v_board.parent_id,
      'title', v_board.title, 'kind', v_board.kind, 'owner_id', v_board.owner_id,
      'owner_name', v_owner_name,
      'default_access', case when v_teacher then v_board.default_access end,
      'hide_mode', v_board.hide_mode, 'revealed', v_board.revealed,
      'show_criteria', v_board.show_criteria, 'unlocked', v_board.unlocked,
      'auto_personal', v_board.auto_personal,
      'locked', v_locked, 'access', v_access,
      'can_write', v_teacher or (v_access = 'edit' and not v_locked),
      'evaluation_board_id', v_eval_board,
      'has_personal_children', exists (select 1 from boards where parent_id = p_board and kind = 'personal')
    ),
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'stage', c.stage, 'position', c.position, 'color', c.color,
        'hide_applies', c.hide_applies,
        'effective_hide', public.column_hide_mode(c.id),
        'hidden_count', case
          when not v_teacher and not v_locked and public.column_hide_mode(c.id) = 'count'
          then (select count(*) from cards x where x.column_id = c.id and x.author_id <> v_uid)
          else 0 end
      ) order by c.position, c.id)
      from columns c where c.board_id = p_board
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(card order by (card ->> 'position')::double precision, card ->> 'created_at')
      from (
        select jsonb_build_object(
          'id', x.id, 'column_id', x.column_id, 'title', x.title, 'body', x.body,
          'labels', to_jsonb(x.labels), 'due_date', x.due_date, 'checklist', x.checklist,
          'position', x.position, 'created_at', x.created_at, 'updated_at', x.updated_at,
          'is_mine', x.author_id = v_uid,
          'author_id', case when v_teacher or x.author_id = v_uid or m.mode = 'off' then x.author_id end,
          'author_name', case when v_teacher or x.author_id = v_uid or m.mode = 'off' then pf.display_name end,
          'can_edit', v_teacher or (x.author_id = v_uid and v_access = 'edit' and not v_locked),
          'attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', a.id, 'type', a.type, 'name', a.name, 'storage_path', a.storage_path,
              'thumb_path', a.thumb_path, 'url', a.url, 'size', a.size, 'page_count', a.page_count,
              'preview', case when a.type = 'link' then (
                select jsonb_build_object('title', lp.title, 'description', lp.description,
                  'image_url', lp.image_url, 'site_name', lp.site_name, 'ok', lp.ok)
                from link_previews lp where lp.url_hash = encode(extensions.digest(a.url, 'sha256'), 'hex')
              ) end
            ) order by a.created_at)
            from attachments a where a.card_id = x.id
          ), '[]'::jsonb)
        ) as card
        from cards x
        join lateral (select public.column_hide_mode(x.column_id) as mode) m on true
        left join profiles pf on pf.id = x.author_id
        where x.board_id = p_board
          and (v_teacher or (not v_locked and (x.author_id = v_uid or m.mode in ('off', 'anonymous'))))
      ) s
    ), '[]'::jsonb),
    'criteria', case when v_teacher or v_show_criteria then coalesce((
      select jsonb_agg(jsonb_build_object('id', cr.id, 'name', cr.name, 'description', cr.description,
                                          'levels', cr.levels) order by bc.position, cr.name)
      from board_criteria bc join criteria cr on cr.id = bc.criterion_id
      where bc.board_id = v_eval_board
    ), '[]'::jsonb) else '[]'::jsonb end,
    'my_evaluation', case when v_teacher then null else (
      select jsonb_build_object(
        'levels', e.levels, 'feedback', e.feedback, 'updated_at', e.updated_at,
        'criteria', coalesce((
          select jsonb_agg(jsonb_build_object('id', cr.id, 'name', cr.name, 'description', cr.description,
                                              'levels', cr.levels) order by bc.position, cr.name)
          from criteria cr left join board_criteria bc on bc.criterion_id = cr.id and bc.board_id = v_eval_board
          where e.levels ? cr.id::text
        ), '[]'::jsonb))
      from evaluations e
      where e.board_id = v_eval_board and e.student_id = v_uid and e.published
        and (v_board.kind = 'shared' or v_board.owner_id = v_uid)
    ) end
  ) into v_result;
  return v_result;
end $$;

-- 카드 상세의 활동 기록. 작성자가 가려진 카드는 행위자를 비운다.
create or replace function public.get_card_activities(p_card uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_card cards;
  v_reveal boolean;
begin
  if not public.can_read_card(p_card) then
    return null;
  end if;
  select * into v_card from cards where id = p_card;
  v_reveal := public.is_board_teacher(v_card.board_id) or v_card.author_id = auth.uid()
              or public.column_hide_mode(v_card.column_id) = 'off';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'created_at', a.created_at,
      'actor_name', case when v_reveal then pf.display_name end,
      'from_column', fc.name, 'to_column', tc.name
    ) order by a.created_at, a.id)
    from activities a
    left join profiles pf on pf.id = a.actor_id
    left join columns fc on fc.id = a.from_column
    left join columns tc on tc.id = a.to_column
    where a.card_id = p_card
  ), '[]'::jsonb);
end $$;

-- 교사용 학생별 보기 (R11)
create or replace function public.get_board_student_summary(p_board uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_teacher uuid;
begin
  if not public.is_board_teacher(p_board) then
    raise exception 'only the project teacher can view the summary' using errcode = '42501';
  end if;
  select pr.teacher_id into v_teacher from boards bo join projects pr on pr.id = bo.project_id where bo.id = p_board;
  return jsonb_build_object(
    'columns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color)
                                          order by c.position, c.id)
                         from columns c where c.board_id = p_board), '[]'::jsonb),
    'has_criteria', exists (select 1 from board_criteria where board_id = p_board),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', st.id, 'display_name', st.display_name, 'login_id', st.login_id, 'active', st.active,
        'counts', coalesce((
          select jsonb_object_agg(c.id, (select count(*) from cards x where x.column_id = c.id and x.author_id = st.id))
          from columns c where c.board_id = p_board
        ), '{}'::jsonb),
        'personal_board_id', pb.id,
        'personal_count', case when pb.id is null then null else
          (select count(*) from cards x where x.board_id = pb.id) end,
        'personal_counts', case when pb.id is null then null else coalesce((
          select jsonb_agg(jsonb_build_object('name', c.name, 'count',
                   (select count(*) from cards x where x.column_id = c.id)) order by c.position, c.id)
          from columns c where c.board_id = pb.id), '[]'::jsonb) end,
        'evaluation_status', case
          when e.id is null then 'none'
          when e.published then 'published'
          else 'draft' end
      ) order by st.display_name, st.login_id)
      from profiles st
      left join boards pb on pb.parent_id = p_board and pb.kind = 'personal' and pb.owner_id = st.id
      left join evaluations e on e.board_id = p_board and e.student_id = st.id
      where st.role = 'student' and st.teacher_id = v_teacher
    ), '[]'::jsonb)
  );
end $$;

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.login_attempts enable row level security;
alter table public.projects enable row level security;
alter table public.boards enable row level security;
alter table public.board_permissions enable row level security;
alter table public.columns enable row level security;
alter table public.cards enable row level security;
alter table public.attachments enable row level security;
alter table public.link_previews enable row level security;
alter table public.activities enable row level security;
alter table public.board_events enable row level security;
alter table public.criteria enable row level security;
alter table public.board_criteria enable row level security;
alter table public.evaluations enable row level security;

-- profiles: 본인, 교사는 자기 학생, 학생은 자기 교사
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or teacher_id = auth.uid() or id = public.group_teacher_id());
create policy profiles_update on public.profiles for update to authenticated
  using (teacher_id = auth.uid() and public.my_role() = 'teacher')
  with check (teacher_id = auth.uid());

-- login_attempts, link_previews: 클라이언트 정책 없음(서버 service role 전용)

-- projects
create policy projects_select on public.projects for select to authenticated
  using (
    (teacher_id = auth.uid() and public.my_role() = 'teacher')
    or (public.my_role() = 'student' and teacher_id = public.group_teacher_id() and archived_at is null)
  );
create policy projects_insert on public.projects for insert to authenticated
  with check (teacher_id = auth.uid() and public.my_role() = 'teacher');
create policy projects_update on public.projects for update to authenticated
  using (teacher_id = auth.uid() and public.my_role() = 'teacher')
  with check (teacher_id = auth.uid());
create policy projects_delete on public.projects for delete to authenticated
  using (teacher_id = auth.uid() and public.my_role() = 'teacher');

-- boards: 읽기 권한 이상만 행이 보인다. 쓰기는 교사만.
create policy boards_select on public.boards for select to authenticated
  using (public.can_read_board(id));
create policy boards_insert on public.boards for insert to authenticated
  with check (public.is_project_teacher(project_id));
create policy boards_update on public.boards for update to authenticated
  using (public.is_project_teacher(project_id)) with check (public.is_project_teacher(project_id));
create policy boards_delete on public.boards for delete to authenticated
  using (public.is_project_teacher(project_id));

-- board_permissions: 교사만
create policy board_permissions_teacher on public.board_permissions for all to authenticated
  using (public.is_board_teacher(board_id)) with check (public.is_board_teacher(board_id));

-- columns
create policy columns_select on public.columns for select to authenticated
  using (public.can_read_board(board_id));
create policy columns_write on public.columns for all to authenticated
  using (public.is_board_teacher(board_id)) with check (public.is_board_teacher(board_id));

-- cards: 테이블 직접 조회는 작성자가 드러나도 되는 카드만. 개수만·익명은 get_board_view로만.
create policy cards_select on public.cards for select to authenticated
  using (
    public.is_board_teacher(board_id)
    or (public.student_access(board_id) <> 'none' and not public.board_locked(board_id)
        and (author_id = auth.uid() or public.column_hide_mode(column_id) = 'off'))
  );
create policy cards_insert on public.cards for insert to authenticated
  with check (author_id = auth.uid() and public.can_edit_board(board_id));
create policy cards_update on public.cards for update to authenticated
  using (public.is_board_teacher(board_id) or (author_id = auth.uid() and public.can_edit_board(board_id)))
  with check (public.is_board_teacher(board_id) or (author_id = auth.uid() and public.can_edit_board(board_id)));
create policy cards_delete on public.cards for delete to authenticated
  using (public.is_board_teacher(board_id) or (author_id = auth.uid() and public.can_edit_board(board_id)));

-- attachments
create policy attachments_select on public.attachments for select to authenticated
  using (public.can_read_card(card_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (created_by = auth.uid() and public.can_write_card(card_id));
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.can_write_card(card_id));

-- activities: 교사, 또는 작성자가 드러나는 카드를 읽을 수 있는 학생
create policy activities_select on public.activities for select to authenticated
  using (public.is_board_teacher(board_id) or exists (select 1 from public.cards c where c.id = card_id));

-- board_events: 같은 교사 그룹이면 신호만 받는다(내용 없음)
create policy board_events_select on public.board_events for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id));

-- criteria
create policy criteria_select on public.criteria for select to authenticated
  using (public.can_read_criterion(id));
create policy criteria_write on public.criteria for all to authenticated
  using (teacher_id = auth.uid() and public.my_role() = 'teacher')
  with check (teacher_id = auth.uid() and public.my_role() = 'teacher');

-- board_criteria
create policy board_criteria_select on public.board_criteria for select to authenticated
  using (public.is_board_teacher(board_id) or public.can_read_criterion(criterion_id));
create policy board_criteria_write on public.board_criteria for all to authenticated
  using (public.is_board_teacher(board_id)) with check (public.is_board_teacher(board_id));

-- evaluations: 학생은 본인 것 + 공개된 것만
create policy evaluations_teacher on public.evaluations for all to authenticated
  using (public.is_board_teacher(board_id)) with check (public.is_board_teacher(board_id));
create policy evaluations_student on public.evaluations for select to authenticated
  using (student_id = auth.uid() and published and public.my_role() = 'student');

------------------------------------------------------------------------------
-- 함수 실행 권한
------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public._create_personal_board(uuid, uuid) from authenticated;
revoke execute on function public.touch_board(uuid, text) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

------------------------------------------------------------------------------
-- 실시간
------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.board_events;
  end if;
end $$;

------------------------------------------------------------------------------
-- Storage: 비공개 버킷 + 카드 읽기 권한과 같은 정책
-- 경로: <board_id>/<card_id>/<file>
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-attachments', 'card-attachments', false, 20971520,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy card_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'card-attachments'
         and public.can_read_card(public.try_uuid((storage.foldername(name))[2])));
create policy card_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'card-attachments'
              and public.can_write_card(public.try_uuid((storage.foldername(name))[2]))
              and exists (select 1 from public.cards c
                          where c.id = public.try_uuid((storage.foldername(name))[2])
                            and c.board_id = public.try_uuid((storage.foldername(name))[1])));
create policy card_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'card-attachments'
         and public.can_write_card(public.try_uuid((storage.foldername(name))[2])));
