-- Förslag för separat granskning. Körs inte mot hostad miljö i denna etapp.
-- Endast de två avsiktliga revisionskonflikternas felkod ändras.
begin;
do $guard$
begin
  if current_user <> 'postgres' or not exists (
    select from pg_proc p
    where p.oid=to_regprocedure('public.apply_operation(uuid,text,uuid,bigint,jsonb,text)')
      and p.proowner='postgres'::regrole and p.prosecdef
      and p.proconfig=array['search_path=""']
      and encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='3e2f3c39ecf6d3926f1da6b829c6dc06007560bafd97b88ddde6597a94d95e22'
  ) then
    raise exception 'apply_operation_drift_review_required' using errcode='22023';
  end if;
end;
$guard$;

create or replace function public.apply_operation(
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
    if p_expected_revision <> 0 or p_action <> 'put' then raise exception 'revision_conflict' using errcode = 'PT409'; end if;
    next_revision := 1;
  else
    if oldrow.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = 'PT409'; end if;
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

commit;
