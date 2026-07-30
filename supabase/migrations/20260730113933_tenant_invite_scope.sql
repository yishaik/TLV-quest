begin;

alter table public.organizer_invites
  add column tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

create index organizer_invites_tenant_idx
  on public.organizer_invites(tenant_id, created_at desc);

commit;
