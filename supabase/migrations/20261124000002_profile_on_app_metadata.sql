-- Supabase Auth의 admin.createUser는 auth.users를 먼저 insert하고 app_metadata(role 등)는
-- 뒤이은 update로 채운다. insert 트리거만으로는 role을 못 보므로, app_metadata가 바뀔 때도
-- 프로필이 없으면 만든다. app_metadata는 service role만 바꿀 수 있어 사용자가 role을 고를 수 없다.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := new.raw_app_meta_data ->> 'role';
begin
  if exists (select 1 from profiles where id = new.id) then
    return new;
  end if;
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

drop trigger if exists on_auth_user_app_metadata_updated on auth.users;
create trigger on_auth_user_app_metadata_updated after update of raw_app_meta_data on auth.users
for each row when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
