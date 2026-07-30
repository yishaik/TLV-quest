create index if not exists photo_uploads_run_idx
on public.photo_uploads(run_id);

create index if not exists photo_uploads_team_idx
on public.photo_uploads(team_id);

create index if not exists photo_uploads_checkpoint_idx
on public.photo_uploads(checkpoint_id);
