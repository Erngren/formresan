-- Endast granskning efter separat tillstånd. Installerar ingenting.
-- Projektidentitet/dedikerat ändamål och godkännande måste kontrolleras manuellt.
begin transaction read only;

select 'executor_is_postgres' as check_name, current_user = 'postgres' as passed
union all
select 'no_formresan_relations', not exists (
  select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots')
)
union all
select 'no_formresan_function_overloads', not exists (
  select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='apply_operation'
)
union all
select 'no_private_schema', to_regnamespace('formresan_private') is null
union all
select 'no_public_application_relations', not exists (
  select from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')
    and not exists (select from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
)
union all
select 'no_public_application_functions', not exists (
  select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and not exists (select from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
)
union all
select 'auth_empty_before_test_accounts', not exists (select from auth.users)
union all
select 'storage_empty', not exists (select from storage.objects);

-- Inventering för mänsklig granskning. Inga rader, användar-ID:n eller hemligheter.
select nspname as schema_name from pg_namespace
where nspname !~ '^pg_' and nspname <> 'information_schema' order by nspname;

select n.nspname as schema_name, c.relname as object_name, c.relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' order by c.relname;

select pg_get_userbyid(d.defaclrole) as creator,
  case when d.defaclnamespace=0 then '(global)' else n.nspname end as scope,
  d.defaclobjtype, d.defaclacl::text as grants
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
where d.defaclrole='postgres'::regrole order by scope,d.defaclobjtype;

select to_regclass('supabase_migrations.schema_migrations') is not null as migration_history_exists;
-- Om true: granska historiken separat med behörig operatör före installation.
rollback;
