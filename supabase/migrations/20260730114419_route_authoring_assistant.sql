begin;

create table public.route_generation_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizer_tenants(id) on delete cascade,
  template_id uuid references public.game_templates(id) on delete set null,
  requested_by text not null,
  request jsonb not null,
  proposed_route jsonb not null,
  provenance jsonb not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  verification_requirements jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','accepted_for_editing','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check (proposed_route->>'publicationState' = 'draft')
);

create index route_generation_drafts_tenant_idx
  on public.route_generation_drafts(tenant_id, created_at desc);
create index route_generation_drafts_template_idx
  on public.route_generation_drafts(template_id, created_at desc)
  where template_id is not null;

alter table public.route_generation_drafts enable row level security;
revoke all on public.route_generation_drafts from anon, authenticated;
grant all on public.route_generation_drafts to service_role;

commit;
