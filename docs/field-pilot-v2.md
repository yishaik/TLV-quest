# TLV Quest — Two-player field pilot v2

Use this script for the next Tel Aviv Port walk. This is a product pilot, not
a paid event. Stop immediately for any safety issue.

## Before leaving

- [ ] Apply all pending Supabase migrations.
- [ ] Confirm the tested deployment is `READY` and `/api/admin/health` is healthy.
- [ ] Use two real phones: one iPhone/Safari and one Android/Chrome when possible.
- [ ] Put the phones on different mobile networks if possible; disable Wi-Fi.
- [ ] Confirm both devices have camera, location and mobile-data permission.
- [ ] Create one game for **2 participants, 1 team, 6 stops**.
- [ ] Share only the participant join URL. Keep the organizer URL on a third device or browser.
- [ ] Start a stopwatch when the first participant opens the join page.

## Registration and start

- [ ] Player A enters only a first name; WhatsApp is optional.
- [ ] Player B joins from the same URL and lands in the same named team.
- [ ] Neither player is asked to choose or type a team name.
- [ ] Each player sees one primary “enter game” action.
- [ ] Start the run from the organizer screen.
- [ ] Both phones move to stop 1 without refresh or a second link.

## Repeat at every stop

Record one row per stop before continuing.

| Stop | Arrived | Navigation clear? | Task clear? | Answer/photo worked first try? | Success named actor/answer? | Continue worked? | Minutes | Notes |
|---|---|---|---|---|---|---|---:|---|
| 1 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |
| 2 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |
| 3 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |
| 4 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |
| 5 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |
| 6 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | | |

For one text stop, answer on Player A and verify Player B receives who answered,
the answer and points. For one photo stop, upload on the web. A valid JPG/PNG/WebP
must progress even if AI quality matching is weak. For a second photo, use
WhatsApp and verify identical progression.

## Link recovery checks

- [ ] Open the WhatsApp “return to game” link twice.
- [ ] Return to the original browser tab; it must still work.
- [ ] Close and reopen the game from `/resume`; it must restore the current stop.
- [ ] Open Google Maps or Waze once, then return; the game must remain usable.
- [ ] Refresh both phones at different stops; neither may move backward or split teams.

## Stop conditions

Pause the run and record the exact time if any of these occurs:

- a participant is placed in a different team;
- a current game or WhatsApp return link reports expired;
- a valid image cannot be uploaded;
- the two phones show different current stops for more than 10 seconds;
- progress occurs without an explicit submission;
- the route sends players into a closed, crowded or unsafe area.

## Exit interview

Ask each player separately:

1. What was the objective of the story?
2. Which task felt most like a game?
3. Which task felt easiest or most boring?
4. At any point, did you not know what to do next?
5. Would you have preferred four, six or eight stops?

Record total duration, number of hints, wrong answers, photo retries, link
recoveries and any point where either player stopped looking at the physical
environment and focused only on the phone.
