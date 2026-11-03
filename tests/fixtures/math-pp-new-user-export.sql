-- Exact function export supplied by the project owner, 2026-11-03.
-- Reviewed as the same SQL token stream as the legacy validator, with different formatting.
CREATE OR REPLACE FUNCTION public.pp_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 nick text;
 key text;
 expected_email text;
begin
 nick:=normalize(
  btrim(coalesce(new.raw_user_meta_data->>'nickname','')),
  NFKC
 );

 if nick !~ '^[A-Za-z0-9_一-鿿]{2,20}$' then
  raise exception '昵称须为2至20个中文、英文字母、数字或下划线';
 end if;

 key:=lower(nick);

 expected_email:=
  encode(
   extensions.digest(convert_to(key,'UTF8'),'sha256'),
   'hex'
  )||'@accounts.example.com';

 if lower(new.email) is distinct from expected_email then
  raise exception '账户标识不匹配';
 end if;

 insert into public.pp_profiles(id,nickname,nickname_key)
 values(new.id,nick,key);

 return new;
end
$function$;
