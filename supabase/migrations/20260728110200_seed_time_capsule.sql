insert into public.game_templates(slug, title, description, active_version, is_active)
values (
  'tel-aviv-port-time-capsule',
  '{"he":"קפסולת הזמן של נמל תל אביב","en":"The Tel Aviv Port Time Capsule"}'::jsonb,
  '{"he":"מרוץ אורבני בעקבות רמזים אמיתיים מהעבר של הנמל","en":"An urban race through real clues from the port’s past"}'::jsonb,
  1,
  true
)
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  active_version = excluded.active_version,
  is_active = excluded.is_active;

insert into public.template_checkpoints(
  template_id, version, slug, sequence_no, kind, latitude, longitude, radius_meters,
  accessibility, config, is_optional, is_active
)
select
  t.id, 1, v.slug, v.sequence_no, v.kind::public.checkpoint_kind,
  v.latitude, v.longitude, v.radius_meters,
  v.accessibility, v.config, false, true
from public.game_templates t
cross join (values
  (
    'port-origin', 1, 'text', 32.09650::double precision, 34.77420::double precision, 120,
    '{"wheelchair":true,"stroller":true,"field_verification_required":true}'::jsonb,
    '{
      "content": {
        "he": {
          "title": "האות הראשון מהעבר",
          "story": "הקפסולה משדרת קטע ארכיון פגום. רק השנה שבה נפתח הנמל יכולה לשחזר אותו.",
          "prompt": "באיזו שנה הוקם נמל תל אביב? שלחו את השנה בלבד.",
          "locationHint": "התחילו בדק המרכזי וחפשו סימנים לעברו של הנמל.",
          "success": "נכון. הקוד הראשון שוחזר: 19–36."
        },
        "en": {
          "title": "The first signal from the past",
          "story": "The capsule is transmitting a damaged archive fragment. Only the year the port opened can restore it.",
          "prompt": "In what year was Tel Aviv Port established? Send the year only.",
          "locationHint": "Begin on the central deck and look for traces of the port’s past.",
          "success": "Correct. The first code was restored: 19–36."
        }
      },
      "interaction": {"primary":"whatsapp","webFallback":true},
      "validation": {"type":"text","accepted":["1936","שנת 1936"],"fuzzyThreshold":0.94},
      "hints": [
        {"he":"הנמל נפתח בעקבות השבתת נמל יפו בתקופת המרד הערבי.","en":"The port opened after Jaffa Port was shut down during the Arab Revolt.","penalty":10},
        {"he":"השנה מתחילה ב־19 ומסתיימת ב־36.","en":"The year begins with 19 and ends with 36.","penalty":15}
      ],
      "scoring": {"basePoints":100,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":420},
      "field_verification_required": true
    }'::jsonb
  ),
  (
    'pioneer-crane', 2, 'photo', 32.09725::double precision, 34.77395::double precision, 80,
    '{"wheelchair":true,"stroller":true,"field_verification_required":true}'::jsonb,
    '{
      "content": {
        "he": {
          "title": "המנוף שזוכר הכול",
          "story": "המנוף הוותיק שמר חלק נוסף מהקוד.",
          "prompt": "מצאו את המנוף ההיסטורי והצטלמו כך שייראה כאילו הוא מרים לפחות אחד מחברי הקבוצה.",
          "locationHint": "במעגנה, סמוך לדק המרכזי.",
          "success": "התמונה נקלטה. המנוף שחרר את הרמז הבא."
        },
        "en": {
          "title": "The crane that remembers",
          "story": "The old port crane is holding another part of the code.",
          "prompt": "Find the historic crane and take a photo that makes it look as if the crane is lifting at least one teammate.",
          "locationHint": "At the marina, near the central deck.",
          "success": "Photo received. The crane released the next clue."
        }
      },
      "interaction": {"primary":"photo","requiresScan":true,"scanSlug":"pioneer-crane","acceptWhatsAppMedia":true},
      "validation": {
        "type":"photo",
        "criteria":"A visible historic port crane and at least one person posing in forced perspective as if being lifted",
        "confidenceThreshold":0.86
      },
      "fallback": {
        "type":"text",
        "he":"אם הצילום לא מאושר: באילו שנים פעל המנוף לפריקה וטעינה? כתבו בפורמט 1938-1965.",
        "en":"If the photo cannot be verified: during which years did the crane load and unload cargo? Use 1938-1965.",
        "accepted":["1938-1965","1938 עד 1965","1938 to 1965"]
      },
      "hints": [
        {"he":"נסו לעמוד רחוק מהמנוף ולמקם אדם קרוב יותר למצלמה.","en":"Stand farther from the crane and place one person closer to the camera.","penalty":5}
      ],
      "scoring": {"basePoints":120,"wrongPenalty":5,"hintPenalty":5,"speedBonusMax":20,"speedBonusWindowSeconds":480},
      "field_verification_required": true
    }'::jsonb
  ),
  (
    'reading-lighthouse-finale', 3, 'finale', 32.103572::double precision, 34.776975::double precision, 100,
    '{"wheelchair":true,"stroller":true,"field_verification_required":true}'::jsonb,
    '{
      "content": {
        "he": {
          "title": "חותמת המגדלור",
          "story": "הקפסולה כמעט פתוחה. המגדלור הישן מחזיק את חותמת הזמן האחרונה.",
          "prompt": "שתפו מיקום נוכחי או אשרו מיקום באתר. לאחר האימות: באיזו שנה הוקם מגדלור רידינג?",
          "locationHint": "התקדמו צפונה לעבר שפך הירקון ותחנת רידינג.",
          "success": "הקפסולה נפתחה. חיברתם בין 1936, המנוף והמגדלור והחזרתם את הסיפור לנמל."
        },
        "en": {
          "title": "The lighthouse seal",
          "story": "The capsule is almost open. The old lighthouse holds the final time seal.",
          "prompt": "Share your current location or verify it in the web app. Then answer: in what year was Reading Lighthouse built?",
          "locationHint": "Walk north toward the Yarkon estuary and Reading Power Station.",
          "success": "The capsule is open. You connected 1936, the crane, and the lighthouse and returned the story to the port."
        }
      },
      "interaction": {"primary":"location_then_text","acceptWhatsAppLocation":true,"webGeolocation":true},
      "validation": {"type":"text","accepted":["1935","שנת 1935"],"fuzzyThreshold":0.94},
      "locationValidation": {"latitude":32.103572,"longitude":34.776975,"radiusMeters":100},
      "hints": [
        {"he":"המגדלור הוקם בידי הבריטים שנה לפני פתיחת הנמל.","en":"The British built the lighthouse one year before the port opened.","penalty":10}
      ],
      "scoring": {"basePoints":150,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":30,"speedBonusWindowSeconds":600},
      "finale": true,
      "field_verification_required": true
    }'::jsonb
  )
) as v(slug, sequence_no, kind, latitude, longitude, radius_meters, accessibility, config)
where t.slug = 'tel-aviv-port-time-capsule'
on conflict (template_id, version, slug) do update set
  sequence_no = excluded.sequence_no,
  kind = excluded.kind,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  radius_meters = excluded.radius_meters,
  accessibility = excluded.accessibility,
  config = excluded.config,
  is_active = true;
