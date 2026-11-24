create table if not exists public.sync_blobs (
  sync_id text primary key check (sync_id ~ '^[a-f0-9]{64}$'),
  payload text not null check (octet_length(payload) <= 524288),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_sync_blobs_updated_at on public.sync_blobs (updated_at);

alter table public.sync_blobs enable row level security;
revoke all on table public.sync_blobs from public, anon, authenticated;

-- 内部限流计数表（开启 RLS 且严禁 anon/authenticated 直接读写）
create table if not exists public.sync_rate_limits (
  bucket_key text primary key,
  window_start bigint not null,
  req_count integer not null default 1,
  updated_at bigint not null
);

create index if not exists idx_sync_rate_limits_updated_at on public.sync_rate_limits (updated_at);

alter table public.sync_rate_limits enable row level security;
revoke all on table public.sync_rate_limits from public, anon, authenticated;

-- 内部辅助函数：优先读取 Cloudflare 网关注入的 cf-connecting-ip（其次 x-real-ip），仅均缺失时才回退解析 x-forwarded-for 末尾可信段，防首段伪造
create or replace function public.extract_sync_client_ip()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_headers_raw text;
  v_headers jsonb;
  v_xff text;
  v_ip text;
begin
  v_headers_raw := current_setting('request.headers', true);
  if v_headers_raw is null or length(trim(v_headers_raw)) = 0 then
    return 'unknown';
  end if;

  begin
    v_headers := v_headers_raw::jsonb;
  exception when others then
    return 'unknown';
  end;

  v_ip := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');
  if v_ip is null then
    v_ip := nullif(trim(v_headers ->> 'x-real-ip'), '');
  end if;
  if v_ip is null then
    v_xff := nullif(trim(v_headers ->> 'x-forwarded-for'), '');
    if v_xff is not null then
      select nullif(trim(part), '')
      into v_ip
      from unnest(string_to_array(v_xff, ',')) with ordinality as t(part, ord)
      where trim(part) <> ''
      order by ord desc
      limit 1;
    end if;
  end if;
  if v_ip is null or v_ip = '' then
    return 'unknown';
  end if;
  return left(v_ip, 64);
end;
$fn$;

-- 内部辅助函数：按窗口对 bucket_key 计数，超限直接抛出 rate_limit_exceeded
create or replace function public.check_sync_rate_limit(
  p_bucket_key text,
  p_window_sec integer,
  p_max_requests integer
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now_sec bigint := floor(extract(epoch from now()))::bigint;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_window_start bigint := (v_now_sec / greatest(p_window_sec, 1)) * greatest(p_window_sec, 1);
  v_count integer;
begin
  insert into public.sync_rate_limits (bucket_key, window_start, req_count, updated_at)
  values (p_bucket_key, v_window_start, 1, v_now_ms)
  on conflict (bucket_key)
  do update set
    window_start = case
      when public.sync_rate_limits.window_start = excluded.window_start
        then public.sync_rate_limits.window_start
      else excluded.window_start
    end,
    req_count = case
      when public.sync_rate_limits.window_start = excluded.window_start
        then public.sync_rate_limits.req_count + 1
      else 1
    end,
    updated_at = excluded.updated_at
  returning req_count into v_count;

  -- 低频清理超过 1 小时的过期限流桶，避免内部表无限增长
  if v_count = 1 and random() < 0.05 then
    delete from public.sync_rate_limits
    where updated_at < (v_now_ms - 3600000);
  end if;

  if v_count > p_max_requests then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
end;
$fn$;

revoke all on function public.extract_sync_client_ip() from public, anon, authenticated;
revoke all on function public.check_sync_rate_limit(text, integer, integer) from public, anon, authenticated;

create or replace function public.get_sync_blob(p_sync_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
  v_client_ip text;
begin
  v_client_ip := public.extract_sync_client_ip();
  -- 入口按来源 IP 限流（60 秒最多 30 次读取，防止无鉴权枚举探测）
  perform public.check_sync_rate_limit('get:ip:' || v_client_ip, 60, 30);

  if p_sync_id is null or p_sync_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('found', false, 'error', 'invalid_sync_id');
  end if;

  -- 按目标 p_sync_id 限流（60 秒最多 20 次读取）
  perform public.check_sync_rate_limit('get:id:' || p_sync_id, 60, 20);

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
  v_client_ip text;
begin
  v_client_ip := public.extract_sync_client_ip();
  -- 入口按来源 IP 限流（60 秒最多 20 次写入，防存储刷写滥用）
  perform public.check_sync_rate_limit('put:ip:' || v_client_ip, 60, 20);

  if p_sync_id is null or p_sync_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sync_id');
  end if;

  -- 按目标 p_sync_id 限流（60 秒最多 12 次写入）
  perform public.check_sync_rate_limit('put:id:' || p_sync_id, 60, 12);

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
