create table if not exists public.sync_blobs (
  sync_id text primary key check (sync_id ~ '^[a-f0-9]{64}$'),
  payload text not null check (octet_length(payload) <= 524288),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_sync_blobs_updated_at on public.sync_blobs (updated_at);

alter table public.sync_blobs enable row level security;
revoke all on table public.sync_blobs from anon, authenticated;

create or replace function public.get_sync_blob(p_sync_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
begin
  if p_sync_id is null or p_sync_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('found', false, 'error', 'invalid_sync_id');
  end if;

  for v_row in
    select payload, updated_at
    from public.sync_blobs
    where sync_id = p_sync_id
    limit 1
  loop
    return jsonb_build_object(
      'found', true,
      'payload', v_row.payload,
      'updated_at', v_row.updated_at
    );
  end loop;

  return jsonb_build_object('found', false);
end;
$fn$;

create or replace function public.put_sync_blob(p_sync_id text, p_payload text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_sync_id is null or p_sync_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sync_id');
  end if;

  if p_payload is null or octet_length(p_payload) = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_payload');
  end if;

  if octet_length(p_payload) > 524288 then
    return jsonb_build_object('ok', false, 'error', 'payload_too_large');
  end if;

  insert into public.sync_blobs (sync_id, payload, updated_at)
  values (p_sync_id, p_payload, v_now)
  on conflict (sync_id)
  do update set
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'updated_at', v_now
  );
end;
$fn$;

create or replace function public.ping_sync()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'ok', true,
    'server_time', (extract(epoch from now()) * 1000)::bigint
  );
$fn$;

grant execute on function public.get_sync_blob(text) to anon, authenticated;
grant execute on function public.put_sync_blob(text, text) to anon, authenticated;
grant execute on function public.ping_sync() to anon, authenticated;
