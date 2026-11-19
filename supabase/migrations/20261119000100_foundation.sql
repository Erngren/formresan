begin;

-- Kör som postgres i en ny, isolerad Supabase-databas. Inga riktiga data flyttas.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
-- Global revoke krävs: en schema-lokal revoke tar inte bort PUBLIC:s globala EXECUTE.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;

create schema formresan_private;
revoke all on schema formresan_private from public, anon, authenticated;

-- Validerar kända fält utan att kasta okända äldre fält. Ingen JSON blir SQL.
create function formresan_private.valid_payload(collection text, p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare x jsonb; s jsonb; k text; d date;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 1048576 then return false; end if;
  if collection = 'user_settings' then
    return jsonb_typeof(p->'protein') = 'number' and (p->>'protein')::numeric >= 0
       and jsonb_typeof(p->'cal') = 'number' and (p->>'cal')::numeric >= 0;
  end if;
  if jsonb_typeof(p->'id') is distinct from 'number' or not ((p->>'id')::numeric > 0 and (p->>'id')::numeric <= 9007199254740991) then return false; end if;
  if jsonb_typeof(p->'date') is distinct from 'string' or (p->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  d := (p->>'date')::date;
  if to_char(d, 'YYYY-MM-DD') <> p->>'date' then return false; end if;
  if collection = 'training_sessions' then
    if not coalesce(p->>'plan' in ('a','b','warm','mob'), false) or jsonb_typeof(p->'exercises') is distinct from 'array' then return false; end if;
    for x in select value from jsonb_array_elements(p->'exercises') loop
      if jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'id') is distinct from 'string' or length(x->>'id') not between 1 and 100 then return false; end if;
      if p->>'plan' in ('a','b') then
        if jsonb_typeof(x->'sets') is distinct from 'array' then return false; end if;
        for s in select value from jsonb_array_elements(x->'sets') loop
          if jsonb_typeof(s) <> 'object' or jsonb_typeof(s->'kg') is distinct from 'number' or jsonb_typeof(s->'reps') is distinct from 'number' then return false; end if;
          if (s->>'kg')::numeric < 0 or (s->>'reps')::numeric < 0 then return false; end if;
        end loop;
      elsif jsonb_typeof(x->'done') is distinct from 'boolean' then return false;
      end if;
    end loop;
    return true;
  elsif collection <> 'main_entries' then return false;
  end if;
  k := p->>'kind';
  if k = 'food' then
    if jsonb_typeof(p->'name') is distinct from 'string' then return false; end if;
    foreach k in array array['kcal','protein'] loop
      if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric < 0 then return false; end if;
    end loop;
  elsif k = 'work' then
    if jsonb_typeof(p->'type') is distinct from 'string' then return false; end if;
    if p ? 'notes' and jsonb_typeof(p->'notes') <> 'string' then return false; end if;
    foreach k in array array['minutes','km','burn'] loop
      if p ? k and (jsonb_typeof(p->k) <> 'number' or (p->>k)::numeric < 0) then return false; end if;
    end loop;
  elsif k = 'sleep' then
    if jsonb_typeof(p->'minutes') is distinct from 'number' or not ((p->>'minutes')::numeric between 0 and 1440) then return false; end if;
    if p ? 'feel' and jsonb_typeof(p->'feel') <> 'string' then return false; end if;
  elsif k = 'weight' then
    if jsonb_typeof(p->'kg') is distinct from 'number' or (p->>'kg')::numeric <= 0 then return false; end if;
  elsif k is distinct from 'creatine' then return false;
  end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function formresan_private.valid_payload(text,jsonb) from public, anon, authenticated;

create table public.main_entries (
  user_id uuid not null references auth.users(id),
  entity_id uuid not null default gen_random_uuid(),
  payload jsonb not null check (formresan_private.valid_payload('main_entries',payload) is true),
  entry_kind text generated always as (payload->>'kind') stored,
  entry_date text generated always as (payload->>'date') stored,
  revision bigint not null check (revision > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  primary key(user_id,entity_id)
);
create index main_entries_date on public.main_entries(user_id,entry_date);
create unique index main_entries_daily on public.main_entries(user_id,entry_kind,entry_date)
  where deleted_at is null and entry_kind in ('sleep','creatine');

create table public.training_sessions (
  user_id uuid not null references auth.users(id), entity_id uuid not null default gen_random_uuid(),
  payload jsonb not null check (formresan_private.valid_payload('training_sessions',payload) is true),
  session_date text generated always as (payload->>'date') stored,
  revision bigint not null check (revision > 0), schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  primary key(user_id,entity_id)
);
create index training_sessions_date on public.training_sessions(user_id,session_date);

create table public.user_settings (
  user_id uuid not null references auth.users(id), entity_id uuid not null default gen_random_uuid(),
  setting_key text not null default 'goals' check (setting_key = 'goals'),
  payload jsonb not null check (formresan_private.valid_payload('user_settings',payload) is true),
  revision bigint not null check (revision > 0), schema_version integer not null default 1 check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  primary key(user_id,entity_id), unique(user_id,setting_key)
);

create table public.sync_operations (
  user_id uuid not null references auth.users(id), operation_id uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(), primary key(user_id,operation_id)
);
create table public.record_versions (
  user_id uuid not null references auth.users(id), collection text not null check (collection in ('main_entries','training_sessions','user_settings')),
  entity_id uuid not null, revision bigint not null check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), schema_version integer not null check (schema_version = 1),
  deleted_at timestamptz, operation_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,collection,entity_id,revision),
  unique(user_id,operation_id),
  foreign key(user_id,operation_id) references public.sync_operations(user_id,operation_id) deferrable initially deferred
);
create table public.migration_batches (
  user_id uuid not null references auth.users(id), batch_id uuid not null default gen_random_uuid(),
  source_hashes jsonb not null check (jsonb_typeof(source_hashes) = 'object'),
  id_mapping jsonb not null default '{}' check (jsonb_typeof(id_mapping) = 'object'),
  expected_count integer not null check (expected_count >= 0), acknowledged_count integer not null default 0 check (acknowledged_count >= 0 and acknowledged_count <= expected_count),
  status text not null default 'pending' check (status in ('pending','running','review','complete','failed')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,batch_id), check (status <> 'complete' or acknowledged_count = expected_count)
);
create table public.migration_snapshots (
  user_id uuid not null, batch_id uuid not null, snapshot_id uuid not null default gen_random_uuid(),
  main_raw text, training_raw text,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,snapshot_id), unique(user_id,batch_id),
  foreign key(user_id,batch_id) references public.migration_batches(user_id,batch_id),
  check (main_raw is not null or training_raw is not null)
);

do $$ declare t text; begin
  foreach t in array array['main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
  end loop;
end $$;

-- Enda klientskrivvägen. Ägaren härleds från JWT, aldrig från payload/argument.
-- SECURITY DEFINER behövs eftersom klienten saknar samtliga tabellskrivrättigheter.
create function public.apply_operation(
  p_operation_id uuid, p_collection text, p_entity_id uuid,
  p_expected_revision bigint, p_payload jsonb, p_action text default 'put'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid(); req jsonb; prior public.sync_operations%rowtype;
  oldrow record; next_revision bigint; now_at timestamptz := clock_timestamp();
  result jsonb; next_payload jsonb; tombstone timestamptz;
begin
  if u is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_operation_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_collection is null or p_collection not in ('main_entries','training_sessions','user_settings')
    or p_action is null or p_action not in ('put','delete','restore') then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  req := jsonb_build_object('collection',p_collection,'entity_id',p_entity_id,'expected_revision',p_expected_revision,'payload',p_payload,'action',p_action);
  -- Samordnar även nya rader och samtidiga återförsök innan någon kvittorad finns.
  -- Hashkollision serialiserar bara orelaterade operationer, påverkar inte identitet.
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  now_at := clock_timestamp();
  select * into prior from public.sync_operations where user_id = u and operation_id = p_operation_id;
  if found then
    if prior.request is distinct from req then raise exception 'operation_id_reused' using errcode = '22023'; end if;
    return prior.receipt;
  end if;
  -- Endast vitlistat tabellnamn interpoleras. Alla värden är bundna parametrar.
  execute format('select payload,revision,deleted_at from public.%I where user_id = $1 and entity_id = $2 for update',p_collection)
    into oldrow using u,p_entity_id;
  if oldrow.revision is null then
    if p_expected_revision <> 0 or p_action <> 'put' then raise exception 'revision_conflict' using errcode = '40001'; end if;
    next_revision := 1;
  else
    if oldrow.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
    if (oldrow.deleted_at is not null and p_action <> 'restore') or (oldrow.deleted_at is null and p_action = 'restore') then
      raise exception 'invalid_record_state' using errcode = '22023';
    end if;
    next_revision := oldrow.revision + 1;
  end if;
  if p_action = 'delete' then
    if p_payload is not null then raise exception 'delete_requires_null_payload' using errcode = '22023'; end if;
    next_payload := oldrow.payload; tombstone := now_at;
  else
    next_payload := p_payload; tombstone := null;
  end if;
  if formresan_private.valid_payload(p_collection,next_payload) is not true then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  -- Bevara gamla numeriska post-ID:n även när innehållet redigeras.
  if oldrow.revision is not null and p_collection <> 'user_settings' and oldrow.payload->'id' is distinct from next_payload->'id' then
    raise exception 'legacy_id_immutable' using errcode = '22023';
  end if;
  if next_revision = 1 then
    execute format('insert into public.%I(user_id,entity_id,payload,revision,created_at,updated_at) values($1,$2,$3,1,$4,$4)',p_collection)
      using u,p_entity_id,next_payload,now_at;
  else
    execute format('update public.%I set payload=$3,revision=$4,updated_at=$5,deleted_at=$6 where user_id=$1 and entity_id=$2',p_collection)
      using u,p_entity_id,next_payload,next_revision,now_at,tombstone;
  end if;
  result := jsonb_build_object('entity_id',p_entity_id,'collection',p_collection,'revision',next_revision,'deleted_at',tombstone,'operation_id',p_operation_id,'updated_at',now_at);
  insert into public.sync_operations(user_id,operation_id,request,receipt,created_at) values(u,p_operation_id,req,result,now_at);
  insert into public.record_versions(user_id,collection,entity_id,revision,payload,schema_version,deleted_at,operation_id,created_at)
    values(u,p_collection,p_entity_id,next_revision,next_payload,1,tombstone,p_operation_id,now_at);
  return result;
end;
$$;
revoke all on function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) to authenticated;

commit;
