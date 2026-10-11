-- Content reference validation, the same rules as `packages/sync-core/src/content-ref.ts`.
-- The client normalises what a person types before calling an RPC (Remote Procedure Call); the
-- database checks the stored form again.
--   youtube: exactly 11 characters of [A-Za-z0-9_-].
--   netflix, prime, disney: an https address whose host, lowercased and without any user name or
--   port, matches the service, with no fragment.
create function public.valid_content_ref(source text, ref text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
begin
  if $1 is null or $2 is null then
    return false;
  end if;

  if $1 = 'youtube' then
    return $2 ~ '^[A-Za-z0-9_-]{11}$';
  end if;

  if $1 not in ('netflix', 'prime', 'disney') then
    return false;
  end if;

  -- The normalised form never holds whitespace, control characters or a fragment.
  if char_length($2) > 2048 or $2 ~ '[[:space:][:cntrl:]]' or position('#' in $2) > 0 then
    return false;
  end if;

  if left($2, 8) <> 'https://' then
    return false;
  end if;

  -- Authority: everything after the scheme up to the first slash, question mark or end.
  v_authority := substring($2 from '^https://([^/?]*)');
  -- Drop a user name (up to the last @) and a port, as a browser does when it reads the host.
  v_host := lower(regexp_replace(regexp_replace(coalesce(v_authority, ''), '^.*@', ''), ':[0-9]*$', ''));
  if v_host = '' then
    return false;
  end if;

  return case $1
    when 'netflix' then v_host ~ '^(www\.)?netflix\.com$'
    when 'prime' then v_host ~ '^(www\.)?(primevideo\.com|amazon\.(com|co\.uk|de|ca))$'
    when 'disney' then v_host ~ '^(www\.)?disneyplus\.com$'
  end;
end;
$$;

revoke execute on function public.valid_content_ref(text, text) from public, anon;
grant execute on function public.valid_content_ref(text, text) to authenticated;
