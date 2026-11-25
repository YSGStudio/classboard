-- 보드 기본 구성을 '빈 보드'로 바꾸고, 카드에 작성자 정보(아이디·역할)를 더한다.
--   공용 보드: 열 없이 시작한다. 교사가 열을 직접 만들거나 '멤버별로 나누기'로 학생마다 열을 만든다.
--   개인 보드: 주인 학생이 바로 쓸 수 있도록 학생 이름 열 하나로 시작한다.
--   열 개수: 0~60 (학급 전체를 학생별 열로 나눌 수 있게)
--   get_board_view: 카드에 author_login, author_role 추가 (author_name과 같은 가리기 규칙)

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
      insert into columns (board_id, name, position, color)
      values (new.id, left(coalesce(nullif(v_owner.display_name, ''), v_owner.login_id, '내 카드'), 40), 1, '#D4E8F8');
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

create or replace function public.columns_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from boards where id = new.board_id for update;
    if (select count(*) from columns where board_id = new.board_id) >= 60 then
      raise exception 'COLUMN_LIMIT: a board can have at most 60 columns' using errcode = '23514';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    return old;
  elsif tg_op = 'UPDATE' then
    if new.board_id <> old.board_id then
      raise exception 'board_id is immutable' using errcode = '42501';
    end if;
    return new;
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
          'author_login', case when v_teacher or x.author_id = v_uid or m.mode = 'off' then pf.login_id end,
          'author_role', case when v_teacher or x.author_id = v_uid or m.mode = 'off' then pf.role end,
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
