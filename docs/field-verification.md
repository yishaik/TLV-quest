# Tel Aviv Port Field Verification

Complete this checklist once before inviting external pilot participants.

## Capture first: `/admin/field`

The original checklist assumed the route already existed and the walk merely
confirmed it. That was backwards, and it is why the checklist stayed unticked:
the content was authored from a desk, and the field visit was being asked to
justify decisions rather than inform them.

The thirteen speculative stations have been deleted. `/admin/field` now
captures points of interest that actually exist, and the route is designed from
them afterwards.

Per point, standing at it:

- **Capture the fix first, name it second.** Standing at the point is the only
  moment the coordinate is free; naming first invites recording it from the
  wrong place later. The screen shows GPS accuracy and warns below 25 m rather
  than saving a bad coordinate silently.
- Add as many photos as the point deserves — what is there, what the signage
  says, what might obstruct a team.
- Record wheelchair and stroller access, mobile reception, a verification
  radius, and free-text notes.
- Mark it captured, approved for use, needs another look, or unsuitable.

Once enough real points exist, the route is built from the ones marked approved
— fitting the quest to the ground instead of the ground to the quest.

## Two modes, because they are two different jobs

The first walk came back with nine points, coordinates and photos — and every
survey field empty. That is not carelessness; the form lost to the walk.
Standing at a point you want the shortest path from *I am here* to *saved*, and
eight fields is not that.

So the screen has a switch:

- **בשטח** — capture the fix, name it, add photos. Nothing else is shown.
  These are the two things that cannot be reconstructed later: the coordinate
  requires standing there, and a sign that was never photographed cannot be
  transcribed at home.
- **מהמשרד** — the full survey below, filled in afterwards from the photos.

Field mode is the default, including on the server render, because showing the
long form to someone who is walking is the failure being corrected.

## What to record, and why each one matters

Coordinates and a photo say *where* a point is. Route design starts from a
different question — *what can live here* — and that cannot be answered from a
paragraph of notes weeks later. So the survey is structured:

| Field | Without it |
|---|---|
| A fact or sign to ask about | no text riddle is possible here |
| A distinctive visual subject | no photo riddle is possible here |
| A protected surface for NFC/QR | no fallback when GPS is imprecise |
| Findable from a clue, without navigation | the "puzzle" is just following a map |
| Capacity — one group, a few, or open | thirty participants queue at a bottleneck |
| Availability — always, daylight, restricted | an evening event dies at a locked gate |
| Signage transcribed **verbatim** | answers cannot be authored, and a paraphrase silently breaks them |
| Hazards | a teen group is sent somewhere unsafe |

Each collapsed card shows what is still missing, so a gap is visible while
standing at the point rather than discovered when the route is designed and the
only fix is another trip.

The survey lives in the existing `health_checklist` column; access flags stay in
`accessibility`. No migration.

The station library seeded by earlier migrations is gone from the database. It
remains reproducible from `supabase/migrations/` if it is ever wanted back.

## General route

- [ ] Confirm the short route is safe and walkable in both directions.
- [ ] Measure actual distance and typical walking time.
- [ ] Confirm every stop is wheelchair- and stroller-accessible or document an alternative.
- [ ] Identify construction, security barriers, events or seasonal closures.
- [ ] Test mobile reception on at least two networks.
- [ ] Test all pages on Android Chrome and iPhone Safari.

## 1. Port origin (`port-origin`)

- [ ] Confirm a clear and legal central meeting point.
- [ ] Record exact coordinates and acceptable verification radius.
- [ ] Confirm participants can discover or infer 1936 from the environment or a fair clue.
- [ ] Photograph relevant signs and write exact wording in Hebrew and English.

## 2. Pioneer crane (`pioneer-crane`)

- [ ] Confirm the historic crane is present, publicly visible and safely approachable.
- [ ] Confirm exact coordinates.
- [ ] Identify a protected location for an NFC tag and QR backup, or a cooperating business.
- [ ] Test the forced-perspective photo task in morning, afternoon and low light.
- [ ] Capture 15–20 approved and rejected sample photos for Gemini threshold tuning.
- [ ] Verify the public information supporting the 1938–1965 fallback answer.

## 3. Reading lighthouse (`reading-lighthouse-finale`)

- [ ] Confirm public pedestrian access to the verification area.
- [ ] Confirm the route does not require entering restricted power-station property.
- [ ] Test GPS accuracy around the current 100-meter radius.
- [ ] Confirm the lighthouse is visible from the accessible route.
- [ ] Verify the 1935 historical answer against visible or linked material.

## Physical tag test

- [ ] Program NFC tags as ordinary NDEF URLs under `https://play.yishaik.com/s/<station>`.
- [ ] Print matching QR codes using the same URLs.
- [ ] Test with Android and iOS without installing an app.
- [ ] Confirm the station page rejects a team whose current checkpoint is different.
- [ ] Confirm opening the tag from a new browser provides a clear recovery path.

## Pilot report

Record:

- actual start/end times;
- completion time per checkpoint;
- wrong-answer and hint rates;
- Gemini approvals, confidence and fallbacks;
- location failures and measured distances;
- participant confusion points;
- any unsafe, crowded or inaccessible segment.
