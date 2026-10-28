-- A task the app keeps itself (what is still needed from you): its key, so the daily job finds it again, refreshes its words and
-- closes it once what it asks for has arrived. Tasks you add by hand have none.
alter table public.tasks add column source_key text;
create unique index tasks_source_key on public.tasks (household_id, source_key) where source_key is not null;
