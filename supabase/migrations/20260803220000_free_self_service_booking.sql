-- Free self-service booking.
--
-- Until now a run could only be created from a single-use organizer invite,
-- which an admin had to mint by hand. Opening booking directly from the
-- marketing site needs a way to cap how many free runs one person can create,
-- and the organizer contact is stored encrypted (`organizer_contact_ciphertext`)
-- precisely so it cannot be queried — which also makes it useless for counting.
--
-- So the booker's email is stored a second time as a keyed hash. It is
-- deterministic, so runs can be counted per person; it is not reversible, so
-- the column adds no readable personal data beyond what the ciphertext already
-- holds. The same `hashSecret` (HMAC with `TOKEN_PEPPER`) used for participant
-- and organizer tokens produces it, so an attacker with database access alone
-- cannot enumerate bookers by hashing a list of candidate addresses.
--
-- Null means "not a free booking" — invite-created runs are unaffected and
-- uncapped.

begin;

alter table public.game_runs
  add column if not exists booker_email_hash text;

comment on column public.game_runs.booker_email_hash is
  'Keyed hash of the free-booking organizer email. Null for invite-created runs. Used only to enforce the per-person free-run cap.';

-- Partial: only free bookings carry a value, and the cap query always filters
-- on a specific hash.
create index if not exists game_runs_booker_email_hash_idx
  on public.game_runs(booker_email_hash)
  where booker_email_hash is not null;

commit;
