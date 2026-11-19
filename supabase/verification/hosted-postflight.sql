-- Endast läsning, efter godkänd installation och före skapande av testposter.
-- Förutsätter att samtliga sju tabeller finns. Saknad tabell/funktion = stopp.
begin transaction read only;

with expected(name) as (values ('main_entries'),('training_sessions'),('user_settings'),
  ('record_versions'),('sync_operations'),('migration_batches'),('migration_snapshots')),
objects as (
  select c.* from expected e join pg_class c on c.oid=to_regclass('public.'||e.name)
)
select 'seven_owned_rls_tables' as check_name,
  count(*)=7 and coalesce(bool_and(relkind='r' and relrowsecurity and relowner='postgres'::regrole),false) as passed from objects
union all
select 'only_owner_select_policies', count(*)=7 and coalesce(bool_and(
  p.polname='owner_read' and p.polcmd='r' and p.polpermissive
  and p.polroles=array['authenticated'::regrole::oid]
  and p.polwithcheck is null
  and lower(regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]()]','','g'))='selectauth.uidasuid=user_id'
),false) from pg_policy p join objects o on o.oid=p.polrelid
union all
select 'authenticated_select_only', coalesce(bool_and(
  has_table_privilege('authenticated',oid,'SELECT')
  and not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not exists (select from pg_attribute a where a.attrelid=objects.oid and a.attnum>0 and not a.attisdropped
    and has_column_privilege('authenticated',objects.oid,a.attnum,'INSERT,UPDATE,REFERENCES'))
),false) from objects
union all
select 'anon_no_table_or_column_privileges', coalesce(bool_and(
  not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not exists (select from pg_attribute a where a.attrelid=objects.oid and a.attnum>0 and not a.attisdropped
    and has_column_privilege('anon',objects.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))
),false) from objects;

select 'public_schema_expected_client_rights' as check_name,
  has_schema_privilege('authenticated','public','USAGE')
  and not has_schema_privilege('anon','public','CREATE') and not has_schema_privilege('authenticated','public','CREATE') as passed
union all
select 'private_schema_no_client_usage',
  not has_schema_privilege('anon','formresan_private','USAGE') and not has_schema_privilege('authenticated','formresan_private','USAGE')
union all
select 'rpc_only_authenticated',
  has_function_privilege('authenticated','public.apply_operation(uuid,text,uuid,bigint,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.apply_operation(uuid,text,uuid,bigint,jsonb,text)','EXECUTE')
union all
select 'rpc_definer_owner_and_search_path', prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""']
  from pg_proc where oid='public.apply_operation(uuid,text,uuid,bigint,jsonb,text)'::regprocedure
union all
select 'validator_no_client_execute',
  not has_function_privilege('authenticated','formresan_private.valid_payload(text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','formresan_private.valid_payload(text,jsonb)','EXECUTE');

with denied(grantee) as (values (0::oid),('anon'::regrole::oid),('authenticated'::regrole::oid)),
global_acl as (
  select coalesce((select defaclacl from pg_default_acl where defaclrole='postgres'::regrole
    and defaclnamespace=0 and defaclobjtype='f'),acldefault('f','postgres'::regrole)) as acl
)
select 'global_future_functions_closed' as check_name, not exists (
  select from global_acl g, lateral aclexplode(g.acl) a join denied d on d.grantee=a.grantee
  where a.privilege_type='EXECUTE'
) as passed
union all
select 'public_future_functions_closed', not exists (
  select from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
  join denied x on x.grantee=a.grantee
  where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace
    and d.defaclobjtype='f' and a.privilege_type='EXECUTE'
)
union all
select 'no_public_execute_on_formresan_functions', not exists (
  select from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid in ('public.apply_operation(uuid,text,uuid,bigint,jsonb,text)'::regprocedure,
    'formresan_private.valid_payload(text,jsonb)'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'
);

-- Före testdata krävs noll i alla tabeller. Efter tester är dessa tal avsiktligt >0.
select 'main_entries' as table_name,count(*) as row_count from public.main_entries
union all select 'training_sessions',count(*) from public.training_sessions
union all select 'user_settings',count(*) from public.user_settings
union all select 'record_versions',count(*) from public.record_versions
union all select 'sync_operations',count(*) from public.sync_operations
union all select 'migration_batches',count(*) from public.migration_batches
union all select 'migration_snapshots',count(*) from public.migration_snapshots;

-- Granska kvalifikationen även manuellt och jämför med den mergade migrationen.
select c.relname,p.polname,p.polcmd,pg_get_expr(p.polqual,p.polrelid) as owner_predicate
from pg_policy p join pg_class c on c.oid=p.polrelid
where c.relnamespace='public'::regnamespace and c.relname in
  ('main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots')
order by c.relname;
rollback;
