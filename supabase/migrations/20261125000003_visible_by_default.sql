-- 기본은 모두 보이게
--   1) 새 작업장의 기본 권한을 '수정'(보기 + 쓰기)으로. 이미 '없음'인 공유 작업장도 '수정'으로 바꾼다.
--      (학생별로 따로 준 권한 board_permissions는 그대로 둔다. 개인 보드는 트리거가 'none'으로 두고 주인만 본다)
--   2) 교사가 쓴 카드는 가리기와 상관없이 모두에게 보인다(작성자 이름도).

alter table public.boards alter column default_access set default 'edit';
update public.boards set default_access = 'edit' where kind = 'shared' and default_access = 'none';

create or replace function public.is_teacher_profile(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p and role = 'teacher')
$$;
revoke execute on function public.is_teacher_profile(uuid) from public, anon;
grant execute on function public.is_teacher_profile(uuid) to authenticated;

create or replace function public.can_read_card(card uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when public.is_board_teacher(c.board_id) then true
      when public.student_access(c.board_id) = 'none' or public.board_locked(c.board_id) then false
      when c.author_id = auth.uid() or public.is_teacher_profile(c.author_id) then true
      else public.column_hide_mode(c.column_id) in ('off', 'anonymous')
    end
    from cards c where c.id = card
  ), false)
$$;

drop policy if exists cards_select on public.cards;
create policy cards_select on public.cards for select to authenticated
  using (
    public.is_board_teacher(board_id)
    or (public.student_access(board_id) <> 'none' and not public.board_locked(board_id)
        and (author_id = auth.uid() or public.is_teacher_profile(author_id) or public.column_hide_mode(column_id) = 'off'))
  );

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
  select show_criteria into v_show_criteria from boards where id = v_eval_board;
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
