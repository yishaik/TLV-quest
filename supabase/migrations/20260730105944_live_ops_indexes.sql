create index if not exists in_app_banners_team_active_idx
  on public.in_app_banners(team_id, active_until desc)
  where revoked_at is null;
