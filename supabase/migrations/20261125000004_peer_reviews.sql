-- 동료평가
--   columns.member_id: 이 섹션의 주인 학생(멤버별 섹션·개인 보드 섹션). 섹션 머리에 '내 평가 보기'/'평가하기' 버튼을 단다.
--   boards.peer_review: 이 작업장에서 학생끼리 평가하기(기본 켬). 켜져 있으면 학생도 평가 기준을 본다.
--   peer_reviews: (작업장, 평가한 학생, 평가받은 학생)당 1행. stars = {기준 id: 1..단계 수}. 자기 자신은 평가할 수 없다.
--   save_peer_review: 검증 후 저장(빈 별점이면 지움). get_review_summary: 교사 평가 + 동료평가 평균(평가자는 드러나지 않음)

alter table public.columns add column if not exists member_id uuid references public.profiles (id) on delete set null;
create index if not exists columns_member_id_idx on public.columns (member_id);

-- 이미 만든 '01. 이름' 멤버 섹션과 개인 보드 섹션에 주인을 채운다(이름이 한 명과만 맞을 때)
update public.columns c set member_id = b.owner_id
from public.boards b
where b.id = c.board_id and b.kind = 'personal' and c.member_id is null and c.position = 1;

update public.columns c set member_id = m.student_id
from (
  select c2.id as column_id, min(p.id::text)::uuid as student_id
  from public.columns c2
  join public.boards b on b.id = c2.board_id and b.kind = 'shared'
  join public.projects pr on pr.id = b.project_id
  join public.profiles p on p.teacher_id = pr.teacher_id and p.role = 'student'
  where c2.member_id is null and c2.name ~ '^\d+\.\s'
    and regexp_replace(c2.name, '^\d+\.\s*', '') = left(coalesce(nullif(p.display_name, ''), p.login_id), 40)
  group by c2.id
  having count(*) = 1
) m
where c.id = m.column_id;

alter table public.boards add column if not exists peer_review boolean not null default true;

create table if not exists public.peer_reviews (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  stars jsonb not null default '{}' check (jsonb_typeof(stars) = 'object'),
  updated_at timestamptz not null default now(),
  unique (board_id, reviewer_id, target_id),
  check (reviewer_id <> target_id)
);
create index if not exists peer_reviews_target_idx on public.peer_reviews (board_id, target_id);
alter table public.peer_reviews enable row level security;

-- 학생은 자기가 한 평가만 본다(받은 평가는 get_review_summary로 평균만). 교사는 자기 보드 전체. 쓰기는 함수로만.
drop policy if exists peer_reviews_select on public.peer_reviews;
create policy peer_reviews_select on public.peer_reviews for select to authenticated
  using (reviewer_id = auth.uid() or public.is_board_teacher(board_id));
drop policy if exists peer_reviews_teacher_delete on public.peer_reviews;
create policy peer_reviews_teacher_delete on public.peer_reviews for delete to authenticated
  using (public.is_board_teacher(board_id));

create or replace function public.save_peer_review(p_board uuid, p_target uuid, p_stars jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_me profiles;
  v_target profiles;
  v_board boards;
  v_clean jsonb := '{}'::jsonb;
  r record;
  v_n int;
  v_val int;
begin
  select * into v_me from profiles where id = v_uid;
  if v_me.id is null or v_me.role <> 'student' or not v_me.active then
    raise exception 'PEER_FORBIDDEN: 학생만 동료평가를 할 수 있습니다.' using errcode = '42501';
  end if;
  select * into v_board from boards where id = p_board;
  if v_board.id is null or v_board.kind <> 'shared' or not v_board.peer_review then
    raise exception 'PEER_FORBIDDEN: 이 작업장은 동료평가를 하지 않습니다.' using errcode = '42501';
  end if;
  if public.student_access(p_board) = 'none' or public.board_locked(p_board) then
    raise exception 'PEER_FORBIDDEN: 이 작업장을 볼 수 없습니다.' using errcode = '42501';
  end if;
  if p_target = v_uid then
    raise exception 'PEER_SELF: 자기 자신은 평가할 수 없습니다.' using errcode = '23514';
  end if;
  select * into v_target from profiles where id = p_target;
  if v_target.id is null or v_target.role <> 'student' or not v_target.active or v_target.teacher_id is distinct from v_me.teacher_id then
    raise exception 'PEER_FORBIDDEN: 평가할 수 없는 대상입니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_stars, '{}'::jsonb)) <> 'object' then
    raise exception 'PEER_INVALID: 별점 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  -- 이 작업장에 붙은 기준만, 1..단계 수 사이의 정수만 남긴다
  for r in
    select cr.id, jsonb_array_length(cr.levels) as n
    from board_criteria bc join criteria cr on cr.id = bc.criterion_id
    where bc.board_id = p_board
  loop
    if p_stars ? r.id::text and jsonb_typeof(p_stars -> r.id::text) = 'number' then
      v_val := (p_stars ->> r.id::text)::numeric::int;
      v_n := r.n;
      if v_val between 1 and v_n then
        v_clean := v_clean || jsonb_build_object(r.id::text, v_val);
      end if;
    end if;
  end loop;
  if v_clean = '{}'::jsonb then
    delete from peer_reviews where board_id = p_board and reviewer_id = v_uid and target_id = p_target;
  else
    insert into peer_reviews (board_id, reviewer_id, target_id, stars)
    values (p_board, v_uid, p_target, v_clean)
    on conflict (board_id, reviewer_id, target_id) do update set stars = excluded.stars, updated_at = now();
  end if;
  return v_clean;
end $$;

-- 한 학생이 받은 평가 요약: 교사 평가(학생 본인에게는 공개된 것만) + 동료평가 기준별 평균과 인원
create or replace function public.get_review_summary(p_board uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_teacher boolean := public.is_board_teacher(p_board);
  v_eval evaluations;
begin
  if not v_teacher then
    -- 학생은 자기 것만. 작업장을 볼 수 있거나, 그 아래 자기 개인 보드가 있어야 한다
    if p_student <> v_uid or (public.student_access(p_board) = 'none'
       and not exists (select 1 from boards where parent_id = p_board and kind = 'personal' and owner_id = v_uid)) then
      return null;
    end if;
  end if;
  select * into v_eval from evaluations where board_id = p_board and student_id = p_student;
  return jsonb_build_object(
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object('id', cr.id, 'name', cr.name, 'description', cr.description,
                                          'levels', cr.levels) order by bc.position, cr.name)
      from board_criteria bc join criteria cr on cr.id = bc.criterion_id
      where bc.board_id = p_board
    ), '[]'::jsonb),
    'teacher', case when v_eval.id is not null and (v_teacher or v_eval.published) then
      jsonb_build_object('levels', v_eval.levels, 'feedback', v_eval.feedback, 'published', v_eval.published)
    end,
    'peer_count', (select count(*) from peer_reviews where board_id = p_board and target_id = p_student),
    'peer_avg', coalesce((
      select jsonb_object_agg(k, a) from (
        select e.key as k, round(avg((e.value)::numeric), 2) as a
        from peer_reviews pr, jsonb_each(pr.stars) e
        where pr.board_id = p_board and pr.target_id = p_student
        group by e.key
      ) s
    ), '{}'::jsonb)
  );
end $$;

revoke execute on function public.save_peer_review(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.get_review_summary(uuid, uuid) from public, anon;
grant execute on function public.save_peer_review(uuid, uuid, jsonb) to authenticated;
grant execute on function public.get_review_summary(uuid, uuid) to authenticated;

create or replace function public.boards_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_parent boards;
  v_owner profiles;
begin
  if tg_op = 'INSERT' then
    select * into v_parent from boards where id = new.parent_id;
    if new.kind = 'personal' then
      select * into v_owner from profiles where id = new.owner_id;
      insert into columns (board_id, name, position, color, member_id)
      values (new.id, left(coalesce(nullif(v_owner.display_name, ''), v_owner.login_id, '내 카드'), 40), 1, '#D4E8F8', new.owner_id);
    elsif v_parent.id is not null then
      insert into board_permissions (board_id, student_id, access)
      select new.id, student_id, access from board_permissions where board_id = v_parent.id;
      if v_parent.kind = 'personal' then
        -- 개인 보드 아래 하위 보드: 주인 학생은 계속 수정할 수 있다
        insert into board_permissions (board_id, student_id, access)
        values (new.id, v_parent.owner_id, 'edit')
        on conflict (board_id, student_id) do update set access = 'edit';
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
  v_peer_review boolean;
  v_owner_name text;
  v_card_fields jsonb;
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
  select show_criteria, peer_review into v_show_criteria, v_peer_review from boards where id = v_eval_board;
  select display_name into v_owner_name from profiles where id = v_board.owner_id;
  -- 학생 개인 보드는 부모 작업장의 카드 형식을 따른다
  if v_board.kind = 'personal' then
    select card_fields into v_card_fields from boards where id = v_board.parent_id;
  end if;
  v_card_fields := coalesce(v_card_fields, v_board.card_fields, '[]'::jsonb);

  select jsonb_build_object(
    'board', jsonb_build_object(
      'id', v_board.id, 'project_id', v_board.project_id, 'parent_id', v_board.parent_id,
      'title', v_board.title, 'kind', v_board.kind, 'owner_id', v_board.owner_id,
      'owner_name', v_owner_name,
      'default_access', case when v_teacher then v_board.default_access end,
      'hide_mode', v_board.hide_mode, 'revealed', v_board.revealed,
      'show_criteria', v_board.show_criteria, 'unlocked', v_board.unlocked,
      'auto_personal', v_board.auto_personal,
      'card_fields', v_card_fields,
      'peer_review', coalesce(v_peer_review, false),
      'viewer_id', v_uid,
      'locked', v_locked, 'access', v_access,
      'can_write', v_teacher or (v_access = 'edit' and not v_locked),
      'evaluation_board_id', v_eval_board,
      'has_personal_children', exists (select 1 from boards where parent_id = p_board and kind = 'personal')
    ),
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'stage', c.stage, 'position', c.position, 'color', c.color,
        'hide_applies', c.hide_applies, 'member_id', c.member_id,
        'effective_hide', public.column_hide_mode(c.id),
        'hidden_count', case
          when not v_teacher and not v_locked and public.column_hide_mode(c.id) = 'count'
          then (select count(*) from cards x where x.column_id = c.id and x.author_id <> v_uid
                  and not public.is_teacher_profile(x.author_id))
          else 0 end
      ) order by c.position, c.id)
      from columns c where c.board_id = p_board
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(card order by (card ->> 'position')::double precision, card ->> 'created_at')
      from (
        select jsonb_build_object(
          'id', x.id, 'column_id', x.column_id, 'title', x.title, 'body', x.body, 'fields', x.fields,
          'labels', to_jsonb(x.labels), 'due_date', x.due_date, 'checklist', x.checklist,
          'position', x.position, 'created_at', x.created_at, 'updated_at', x.updated_at,
          'is_mine', x.author_id = v_uid,
          'author_id', case when v_teacher or x.author_id = v_uid or m.mode = 'off' or pf.role = 'teacher' then x.author_id end,
          'author_name', case when v_teacher or x.author_id = v_uid or m.mode = 'off' or pf.role = 'teacher' then pf.display_name end,
          'author_login', case when v_teacher or x.author_id = v_uid or m.mode = 'off' or pf.role = 'teacher' then pf.login_id end,
          'author_role', case when v_teacher or x.author_id = v_uid or m.mode = 'off' or pf.role = 'teacher' then pf.role end,
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
          and (v_teacher or (not v_locked and (x.author_id = v_uid or pf.role = 'teacher' or m.mode in ('off', 'anonymous'))))
      ) s
    ), '[]'::jsonb),
    'criteria', case when v_teacher or v_show_criteria or v_peer_review then coalesce((
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
