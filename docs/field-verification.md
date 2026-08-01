# Tel Aviv Port Field Verification

Complete this checklist once before inviting external pilot participants.

## Do it from the phone: `/admin/field`

The checklist below is the *what*. `/admin/field` is the *how* — a mobile
verification mode that writes straight into the content tables, so nothing has
to be transcribed twice.

Per station it lets you:

- **measure and save the coordinate.** It shows GPS accuracy and the drift from
  the stored value, and warns before saving a fix worse than 25 m. A bad
  coordinate silently breaks location verification for every future player and
  would not surface until a live run.
- tick the field checks, set the verification radius, leave notes, and move the
  station between `pending` / `verified` / `needs_attention` / `blocked`.
- **capture calibration photos**, each labelled with the verdict a human expects
  from it. The screen tracks accepts and rejects separately and refuses to call
  a station calibration-ready without both — a pile of good photos cannot tell
  you where the threshold is.
- read and edit the question text, the accepted answers, and for photo
  checkpoints the approval criteria and confidence threshold. Signage wording
  is what drives the answers, so it is edited where the signage is read.

Stations are listed south to north, which is the order the port is walked.

Sign in with an address on the admin allowlist; the link must be opened on the
same device.


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
