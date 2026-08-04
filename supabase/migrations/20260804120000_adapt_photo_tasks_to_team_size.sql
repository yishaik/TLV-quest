begin;

-- Group-photo checkpoints declare the smallest team that can reasonably
-- complete them. The runtime uses the actual team membership count to expose
-- the existing text alternative immediately, without forcing a doomed upload.
update public.content_riddles
set validation = validation || jsonb_build_object(
  'minParticipants',
  case
    when slug in ('frame-01-human-logo', 'frame-03-human-wave') then 3
    when slug in ('frame-06-signal-chain', 'frame-09-power-pose') then 2
    else 2
  end
)
where slug in (
  'frame-01-human-logo',
  'frame-03-human-wave',
  'frame-06-signal-chain',
  'frame-09-power-pose',
  'wave-deck-freeze-v2',
  'human-semaphore-v2'
);

update public.template_checkpoints
set config = jsonb_set(
  config,
  '{validation,minParticipants}',
  to_jsonb(
    case
      when slug in ('frame-01-human-logo', 'frame-03-human-wave', 'wave-deck-freeze') then 3
      else 2
    end
  ),
  true
)
where slug in (
  'frame-01-human-logo',
  'frame-03-human-wave',
  'frame-06-signal-chain',
  'frame-09-power-pose',
  'wave-deck-freeze',
  'human-semaphore'
)
and kind = 'photo';

-- Preserve the behavior for runs that were created before this migration.
update public.run_checkpoints
set validation = validation || jsonb_build_object(
  'minParticipants',
  case
    when slug in ('frame-01-human-logo', 'frame-03-human-wave', 'wave-deck-freeze') then 3
    else 2
  end
)
where slug in (
  'frame-01-human-logo',
  'frame-03-human-wave',
  'frame-06-signal-chain',
  'frame-09-power-pose',
  'wave-deck-freeze',
  'human-semaphore'
)
and kind = 'photo';

commit;
