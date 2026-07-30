begin;

create index generated_epilogues_team_idx
  on public.generated_epilogues(team_id)
  where team_id is not null;
create index operational_anomalies_run_idx
  on public.operational_anomalies(run_id)
  where run_id is not null;
create index operational_anomalies_team_idx
  on public.operational_anomalies(team_id)
  where team_id is not null;
create index recap_shares_team_idx
  on public.recap_shares(team_id)
  where team_id is not null;
create index tenant_usage_events_run_idx
  on public.tenant_usage_events(run_id)
  where run_id is not null;

commit;
