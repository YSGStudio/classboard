-- insert ... returning(supabase-js의 .insert().select())은 새 행에 SELECT 정책도 적용한다.
-- can_read_board(id)·can_read_criterion(id)는 STABLE 함수라 문장 시작 시점 스냅숏으로 테이블을 다시
-- 조회하므로 방금 넣은 행을 보지 못해 교사의 보드·기준 생성이 RLS 오류로 실패했다.
-- 행 자체의 컬럼(project_id, teacher_id)만으로 판단하는 조건을 앞에 둔다.

drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (public.is_project_teacher(project_id) or public.can_read_board(id));

drop policy if exists criteria_select on public.criteria;
create policy criteria_select on public.criteria for select to authenticated
  using ((teacher_id = auth.uid() and public.my_role() = 'teacher') or public.can_read_criterion(id));
