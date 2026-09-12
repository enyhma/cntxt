create extension if not exists moddatetime schema extensions;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  tabs jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  type text not null,
  url text,
  note text,
  created_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on workspaces
  for each row execute procedure extensions.moddatetime (updated_at);

alter table workspaces enable row level security;
alter table resources enable row level security;

create policy "workspaces: owner full access"
  on workspaces for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "resources: owner full access via workspace"
  on resources for all
  using (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
  ));
