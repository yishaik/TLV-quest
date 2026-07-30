begin;

do $$
declare
  v_template_id uuid;
begin
  select id into strict v_template_id
  from public.game_templates
  where slug = 'tel-aviv-port-time-capsule';

  insert into public.template_versions (
    template_id, version, status, release_name, release_notes,
    route_config, validation_report, created_by, updated_by
  )
  values (
    v_template_id,
    2,
    'draft',
    'Port Time Capsule — extended route',
    'Ten production-loaded bilingual stops. Publish only after the field-verification checklist passes.',
    '{"routeMode":"linear","audience":"teens","estimatedMinutes":75,"fieldVerificationRequired":true}'::jsonb,
    '{"contentChecks":"passed","fieldChecks":"pending","itemCounts":{"stations":10,"riddles":10,"routeStops":10}}'::jsonb,
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  )
  on conflict (template_id, version) do update set
    status = excluded.status,
    release_name = excluded.release_name,
    release_notes = excluded.release_notes,
    route_config = excluded.route_config,
    validation_report = excluded.validation_report,
    updated_by = excluded.updated_by,
    updated_at = now();

  create temporary table new_stops (
    sequence_no integer,
    slug text,
    kind public.checkpoint_kind,
    latitude double precision,
    longitude double precision,
    radius_meters integer,
    title jsonb,
    description jsonb,
    content jsonb,
    validation jsonb,
    hints jsonb,
    scoring jsonb,
    fallback jsonb,
    interaction jsonb
  ) on commit drop;

  insert into new_stops values
  (1, 'south-gate-signal', 'choice', 32.09606, 34.77455, 90,
   '{"he":"אות המצוקה מן הדרום","en":"The southern distress signal"}',
   '{"he":"קטע הארכיון הראשון מסתתר בכניסה הדרומית לנמל.","en":"The first archive fragment waits at the port’s southern entrance."}',
   '{"he":{"title":"אות המצוקה מן הדרום","story":"השידור הראשון נקטע בדיוק ברגע שבו נולד הנמל העברי.","prompt":"מה היה הזרז המיידי להקמת נמל תל אביב ב־1936? א. שביתה והשבתת נמל יפו; ב. סערה שהרסה את המזח; ג. תחרות שיט בינלאומית","locationHint":"עמדו על הטיילת בכניסה הדרומית, במקום פתוח ובטוח שאינו חוסם מעבר.","success":"נכון. כשהגישה לנמל יפו שובשה, תל אביב הקימה שער ימי משלה."},"en":{"title":"The southern distress signal","story":"The first transmission cuts out at the moment the Hebrew port was born.","prompt":"What directly accelerated the creation of Tel Aviv Port in 1936? A. A strike and shutdown at Jaffa Port; B. A storm destroyed the pier; C. An international sailing race","locationHint":"Stand on the open southern promenade without blocking pedestrian traffic.","success":"Correct. Disrupted access to Jaffa Port pushed Tel Aviv to create its own sea gate."}}',
   '{"type":"choice","accepted":["א","א.","A","a","שביתה","נמל יפו","Jaffa Port strike","strike"]}',
   '[{"he":"חפשו אירוע ששיבש את נתיב היצוא דרך יפו.","en":"Look for an event that disrupted exports through Jaffa.","penalty":10}]',
   '{"basePoints":100,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":360}',
   null,
   '{"primary":"web_or_whatsapp","webFallback":true}'),

  (2, 'warehouse-echo', 'text', 32.09658, 34.77372, 80,
   '{"he":"ההד במחסנים","en":"Echoes in the warehouses"}',
   '{"he":"האנגרים הישנים מזכירים מה עבר כאן לפני המסעדות והחנויות.","en":"The old hangars remember what passed here before restaurants and shops."}',
   '{"he":{"title":"ההד במחסנים","story":"הארכיון מזהה מבנה, אבל שכח מה אוחסן בו.","prompt":"איזה סוג מטען מזוהה במיוחד עם היצוא הארץ־ישראלי שעבר בנמלים בשנות ה־30? כתבו מילה אחת.","locationHint":"התקדמו לאורך שורת ההאנגרים והישארו במרחב הציבורי.","success":"תפוזים. אחד מסמלי היצוא של הארץ חזר לארכיון."},"en":{"title":"Echoes in the warehouses","story":"The archive recognizes a warehouse, but forgot what cargo it held.","prompt":"Which export crop was especially associated with Palestine’s ports in the 1930s? Answer with one word.","locationHint":"Continue along the hangar row and remain in the public promenade.","success":"Oranges. An icon of the era’s exports is back in the archive."}}',
   '{"type":"text","accepted":["תפוז","תפוזים","פרי הדר","oranges","orange","citrus"],"fuzzyThreshold":0.88}',
   '[{"he":"זה פרי הדר שהפך לסמל של יפו.","en":"It is the citrus fruit that became a symbol of Jaffa.","penalty":10}]',
   '{"basePoints":100,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":360}',
   null,
   '{"primary":"whatsapp","webFallback":true}'),

  (3, 'wave-deck-freeze', 'photo', 32.09705, 34.77342, 85,
   '{"he":"הגל שקפא בזמן","en":"The wave frozen in time"}',
   '{"he":"הדק הגלי הופך את הקבוצה לגל אנושי.","en":"The wave deck turns the team into a human wave."}',
   '{"he":{"title":"הגל שקפא בזמן","story":"הקפסולה צריכה תמונת תנועה כדי לכייל את שעון הגאות.","prompt":"צרו תמונה קבוצתית שבה כל משתתף נמצא בגובה אחר, כך שכולכם יחד נראים כמו גל. אל תרוצו ואל תטפסו על מעקות.","locationHint":"בחרו אזור רחב בדק הגלי שאינו מפריע לעוברים ושבים.","success":"הגל נקלט והשעון הימי הסתנכרן."},"en":{"title":"The wave frozen in time","story":"The capsule needs a motion image to calibrate its tide clock.","prompt":"Create a team photo where every participant is at a different height so the group forms one wave. Do not run or climb railings.","locationHint":"Choose a wide section of the wave deck without obstructing pedestrians.","success":"Wave captured. The maritime clock is synchronized."}}',
   '{"type":"photo","criteria":"A group safely posing at different heights to form a wave; no climbing, running, or dangerous proximity to an edge","confidenceThreshold":0.78}',
   '[{"he":"אפשר ליצור גבהים בעזרת כריעה, עמידה וידיים מורמות.","en":"Use crouching, standing, and raised arms to create different heights.","penalty":5}]',
   '{"basePoints":120,"wrongPenalty":0,"hintPenalty":5,"speedBonusMax":20,"speedBonusWindowSeconds":420}',
   '{"type":"text","he":"אם אי אפשר לצלם, כתבו את שם הים שמולכם.","en":"If a photo is not possible, name the sea in front of you.","accepted":["הים התיכון","ים תיכון","Mediterranean","Mediterranean Sea"]}',
   '{"primary":"photo","acceptWhatsAppMedia":true,"webFallback":true}'),

  (4, 'marina-compass', 'text', 32.09768, 34.77318, 85,
   '{"he":"המצפן שאיבד צפון","en":"The compass that lost north"}',
   '{"he":"התרנים במעגנה משדרים קוד כיוון.","en":"The marina masts transmit a directional code."}',
   '{"he":{"title":"המצפן שאיבד צפון","story":"מחוג המצפן של הקפסולה נשבר, אבל קו החוף עדיין יודע את הדרך.","prompt":"אם הים נמצא ממערב לכם, לאיזה כיוון צריך להתקדם כדי להגיע לשפך הירקון ורידינג?","locationHint":"עצרו בנקודת תצפית בטוחה על המעגנה.","success":"צפון. המצפן חזר לפעול."},"en":{"title":"The compass that lost north","story":"The capsule’s compass needle broke, but the coastline still knows the way.","prompt":"If the sea is west of you, which direction should you walk to reach the Yarkon estuary and Reading?","locationHint":"Stop at a safe public viewpoint over the marina.","success":"North. The compass is working again."}}',
   '{"type":"text","accepted":["צפון","צפונה","north","N"],"fuzzyThreshold":0.9}',
   '[{"he":"השפך נמצא בהמשך קו החוף לכיוון רידינג.","en":"The estuary is farther along the coast toward Reading.","penalty":10}]',
   '{"basePoints":90,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":15,"speedBonusWindowSeconds":300}',
   null,
   '{"primary":"web_or_whatsapp","webFallback":true}'),

  (5, 'lighters-secret', 'choice', 32.09828, 34.77336, 90,
   '{"he":"סוד הסירות הקטנות","en":"The secret of the small boats"}',
   '{"he":"לנמל הצעיר לא היה אגן עמוק לאוניות גדולות.","en":"The young port had no deep basin for large ships."}',
   '{"he":{"title":"סוד הסירות הקטנות","story":"אונייה גדולה מופיעה בארכיון—אבל היא אינה מגיעה עד הרציף.","prompt":"כיצד הועבר מטען בין אוניות שעגנו בים לבין הרציף? א. ברכבת תת־ימית; ב. בדוברות וסירות מטען; ג. במסוק","locationHint":"המשיכו צפונה על הטיילת הציבורית.","success":"נכון. דוברות וסירות קטנות גישרו בין האוניות לחוף."},"en":{"title":"The secret of the small boats","story":"A large ship appears in the archive—but it never reaches the quay.","prompt":"How was cargo moved between ships offshore and the pier? A. Underwater railway; B. Lighters and cargo boats; C. Helicopter","locationHint":"Continue north on the public promenade.","success":"Correct. Lighters and small cargo boats bridged ship and shore."}}',
   '{"type":"choice","accepted":["ב","ב.","B","b","דוברות","סירות מטען","lighters","cargo boats"]}',
   '[{"he":"חפשו פתרון ימי קטן שיכול להגיע גם לאונייה וגם לרציף.","en":"Look for a small maritime solution that can reach both ship and pier.","penalty":10}]',
   '{"basePoints":100,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":360}',
   null,
   '{"primary":"web_or_whatsapp","webFallback":true}'),

  (6, 'human-semaphore', 'photo', 32.09905, 34.77362, 90,
   '{"he":"הטלגרף האנושי","en":"The human semaphore"}',
   '{"he":"הקבוצה הופכת לאנטנת קשר בין הים ליבשה.","en":"The team becomes a signal link between sea and land."}',
   '{"he":{"title":"הטלגרף האנושי","story":"מערכת הקשר איבדה את הדגלים שלה.","prompt":"הצטלמו כשרק באמצעות תנוחות ידיים אתם יוצרים שרשרת מסרים: כל אדם מחקה את תנוחת קודמו ומוסיף שינוי אחד. הישארו הרחק משפת המים.","locationHint":"בחרו רחבה פתוחה ובטוחה על הדק הצפוני.","success":"שרשרת האותות הושלמה."},"en":{"title":"The human semaphore","story":"The signal system lost its flags.","prompt":"Take a photo forming a message chain with arm poses: each person copies the previous pose and changes one element. Stay well away from the water’s edge.","locationHint":"Choose an open, safe area on the northern deck.","success":"Signal chain complete."}}',
   '{"type":"photo","criteria":"Two or more people in a safe open area forming a visible sequence of related arm poses","confidenceThreshold":0.74}',
   '[{"he":"עמדו בשורה והתחילו מתנוחה פשוטה שקל לחקות.","en":"Stand in a line and begin with a simple pose that is easy to copy.","penalty":5}]',
   '{"basePoints":120,"wrongPenalty":0,"hintPenalty":5,"speedBonusMax":20,"speedBonusWindowSeconds":420}',
   '{"type":"text","he":"אם אי אפשר לצלם, כתבו מהו סמפור: שיטת איתות באמצעות מה?","en":"If a photo is not possible, semaphore signals use what objects?","accepted":["דגלים","דגל","flags","flag"]}',
   '{"primary":"photo","acceptWhatsAppMedia":true,"webFallback":true}'),

  (7, 'yarkon-bridge-crossing', 'text', 32.10025, 34.77502, 100,
   '{"he":"הגשר בין שני סיפורים","en":"The bridge between two stories"}',
   '{"he":"כאן סיפור הנמל מתחבר לסיפור הירקון.","en":"Here the port story meets the Yarkon story."}',
   '{"he":{"title":"הגשר בין שני סיפורים","story":"הקפסולה מזהה מים מתוקים ומלוחים באותה תמונה.","prompt":"מה שמו של הנחל שמגיע כאן אל הים?","locationHint":"התקרבו לאזור הגשר והשפך דרך שביל ציבורי בלבד.","success":"הירקון. שני נתיבי המים התחברו."},"en":{"title":"The bridge between two stories","story":"The capsule detects fresh and salt water in the same frame.","prompt":"What is the name of the river that reaches the sea here?","locationHint":"Approach the bridge and estuary using public paths only.","success":"The Yarkon. The two waterways are connected."}}',
   '{"type":"text","accepted":["ירקון","הירקון","נחל הירקון","Yarkon","Yarkon River"],"fuzzyThreshold":0.88}',
   '[{"he":"הנחל נותן את שמו לפארק הגדול שממזרח לכם.","en":"The river gives its name to the large park east of you.","penalty":10}]',
   '{"basePoints":100,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":360}',
   null,
   '{"primary":"location_then_text","acceptWhatsAppLocation":true,"webGeolocation":true}'),

  (8, 'estuary-mixing-point', 'choice', 32.10102, 34.77555, 110,
   '{"he":"נקודת הערבוב","en":"The mixing point"}',
   '{"he":"בשפך נפגשים שני סוגי מים ושני עולמות.","en":"At the estuary, two kinds of water and two worlds meet."}',
   '{"he":{"title":"נקודת הערבוב","story":"חיישני הקפסולה מודדים שינוי במליחות.","prompt":"מהו שפך נהר? א. המקום שבו נחל או נהר נשפך לגוף מים גדול; ב. מקור המים בהרים; ג. תעלה מלאכותית בלבד","locationHint":"צפו בשפך ממרחק בטוח, ללא ירידה לשטח סגור או סלעי.","success":"נכון. זה המקום שבו הירקון מסיים את מסעו ופוגש את הים."},"en":{"title":"The mixing point","story":"The capsule’s sensors detect a change in salinity.","prompt":"What is an estuary or river mouth? A. Where a river flows into a larger body of water; B. Its mountain source; C. Only an artificial canal","locationHint":"View the estuary from a safe public path; do not enter restricted or rocky areas.","success":"Correct. This is where the Yarkon ends its journey and meets the sea."}}',
   '{"type":"choice","accepted":["א","א.","A","a","מקום שבו נחל נשפך","river flows into","larger body of water"]}',
   '[{"he":"חשבו על סוף המסלול של הנחל, לא על ההתחלה.","en":"Think about the end of the river’s route, not the beginning.","penalty":10}]',
   '{"basePoints":90,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":15,"speedBonusWindowSeconds":300}',
   null,
   '{"primary":"location_then_choice","acceptWhatsAppLocation":true,"webGeolocation":true}'),

  (9, 'reading-name-code', 'text', 32.10205, 34.77614, 110,
   '{"he":"השם שמאחורי רידינג","en":"The name behind Reading"}',
   '{"he":"תחנת הכוח נושאת שם של מדינאי בריטי.","en":"The power station carries the name of a British statesman."}',
   '{"he":{"title":"השם שמאחורי רידינג","story":"נותר שם אחד שחסר בכותרת הארכיון.","prompt":"תחנת הכוח רידינג נקראת על שם הלורד רידינג. מה היה תפקידו הבכיר בארץ ישראל? א. נציב עליון; ב. ראש עיריית תל אביב; ג. מפקד הנמל","locationHint":"צפו במתחם מרחוק והישארו מחוץ לכל שטח מגודר או תפעולי.","success":"נציב עליון. הכותרת ההיסטורית שוחזרה."},"en":{"title":"The name behind Reading","story":"One name is missing from the archive heading.","prompt":"Reading Power Station is named after Lord Reading. What senior role did he hold in Mandatory Palestine? A. High Commissioner; B. Mayor of Tel Aviv; C. Port commander","locationHint":"View the complex from public space and remain outside all fenced or operational areas.","success":"High Commissioner. The historical heading is restored."}}',
   '{"type":"choice","accepted":["א","א.","A","a","נציב עליון","High Commissioner"]}',
   '[{"he":"זה היה התפקיד האזרחי הבריטי הבכיר בתקופת המנדט.","en":"It was the senior British civil post during the Mandate.","penalty":10}]',
   '{"basePoints":110,"wrongPenalty":5,"hintPenalty":10,"speedBonusMax":20,"speedBonusWindowSeconds":420}',
   null,
   '{"primary":"web_or_whatsapp","webFallback":true}'),

  (10, 'time-capsule-assembly', 'finale', 32.10340, 34.77682, 120,
   '{"he":"הרכבת קפסולת הזמן","en":"Assembling the time capsule"}',
   '{"he":"כל חלקי הסיפור מתחברים מול המגדלור.","en":"Every story fragment comes together by the lighthouse."}',
   '{"he":{"title":"הרכבת קפסולת הזמן","story":"הקפסולה פתוחה, אבל תיפתח רק לקבוצה שמחברת עבר, מקום ועתיד.","prompt":"כתבו הודעה אחת בת עד 12 מילים לתושבי תל אביב של שנת 2126. ההודעה חייבת לכלול את המילים ים וזיכרון.","locationHint":"הגיעו לנקודת תצפית ציבורית ובטוחה על המגדלור; אין להיכנס לשטח תחנת הכוח.","success":"ההודעה נשמרה. קפסולת הזמן מוכנה למסירה ל־2126."},"en":{"title":"Assembling the time capsule","story":"The capsule is open, but only a team connecting past, place, and future can seal it.","prompt":"Write one message of up to 12 words for Tel Aviv residents in 2126. It must include the words sea and memory.","locationHint":"Reach a safe public lighthouse viewpoint; do not enter power-station property.","success":"Message stored. The time capsule is ready for delivery to 2126."}}',
   '{"type":"text_constraints","requiredTerms":{"he":["ים","זיכרון"],"en":["sea","memory"]},"maxWords":12,"minWords":3}',
   '[{"he":"נסחו ברכה קצרה לעיר העתיד ושלבו את שתי מילות החובה.","en":"Write a short wish for the future city and include both required words.","penalty":5}]',
   '{"basePoints":150,"wrongPenalty":0,"hintPenalty":5,"speedBonusMax":25,"speedBonusWindowSeconds":480}',
   '{"type":"text","he":"אם מנגנון הבדיקה נכשל, שלחו: ים זיכרון תל אביב 2126","en":"If validation fails, send: sea memory Tel Aviv 2126","accepted":["ים זיכרון תל אביב 2126","sea memory Tel Aviv 2126"]}',
   '{"primary":"location_then_text","acceptWhatsAppLocation":true,"webGeolocation":true}');

  insert into public.content_stations (
    slug, brand_key, title, description, address, latitude, longitude,
    radius_meters, tags, accessibility, field_verification_required,
    health_status, health_notes, status, created_by, updated_by
  )
  select
    'tel-aviv-port-v2-' || slug,
    'tlv-quest',
    title,
    description,
    jsonb_build_object('he', 'נמל תל אביב', 'en', 'Tel Aviv Port'),
    latitude,
    longitude,
    radius_meters,
    array['tel-aviv-port','time-capsule','v2','teen-route']::text[],
    '{"wheelchair":true,"stroller":true,"field_verification_required":true}'::jsonb,
    true,
    'pending',
    'Production-loaded content. Exact coordinates, access, route safety, and mobile behavior require the documented on-site verification before publication.',
    'active',
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  from new_stops
  on conflict (slug) do update set
    title = excluded.title,
    description = excluded.description,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    accessibility = excluded.accessibility,
    field_verification_required = excluded.field_verification_required,
    health_status = excluded.health_status,
    health_notes = excluded.health_notes,
    status = excluded.status,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.content_riddles (
    station_id, slug, title, kind, content, validation, hints, scoring,
    fallback, interaction, tags, status, created_by, updated_by
  )
  select
    s.id,
    n.slug || '-v2',
    n.title,
    n.kind,
    n.content,
    n.validation,
    n.hints,
    n.scoring,
    n.fallback,
    n.interaction,
    array['tel-aviv-port','time-capsule','v2','bilingual']::text[],
    'active',
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  from new_stops n
  join public.content_stations s on s.slug = 'tel-aviv-port-v2-' || n.slug
  on conflict (station_id, slug) do update set
    title = excluded.title,
    kind = excluded.kind,
    content = excluded.content,
    validation = excluded.validation,
    hints = excluded.hints,
    scoring = excluded.scoring,
    fallback = excluded.fallback,
    interaction = excluded.interaction,
    status = excluded.status,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.content_route_stops (
    template_id, version, station_id, riddle_id, slug, sequence_no,
    is_optional, is_active, overrides, created_by, updated_by
  )
  select
    v_template_id,
    2,
    s.id,
    r.id,
    n.slug,
    n.sequence_no,
    false,
    true,
    '{}'::jsonb,
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  from new_stops n
  join public.content_stations s on s.slug = 'tel-aviv-port-v2-' || n.slug
  join public.content_riddles r on r.station_id = s.id and r.slug = n.slug || '-v2'
  on conflict (template_id, version, slug) do update set
    station_id = excluded.station_id,
    riddle_id = excluded.riddle_id,
    sequence_no = excluded.sequence_no,
    is_active = excluded.is_active,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.template_checkpoints (
    template_id, version, slug, sequence_no, kind, latitude, longitude,
    radius_meters, accessibility, config, is_optional, is_active,
    source_station_id, source_riddle_id, source_route_stop_id
  )
  select
    v_template_id,
    2,
    n.slug,
    n.sequence_no,
    n.kind,
    n.latitude,
    n.longitude,
    n.radius_meters,
    '{"wheelchair":true,"stroller":true,"field_verification_required":true}'::jsonb,
    jsonb_build_object(
      'content', n.content,
      'validation', n.validation,
      'hints', n.hints,
      'scoring', n.scoring,
      'fallback', n.fallback,
      'interaction', n.interaction,
      'field_verification_required', true
    ),
    false,
    true,
    s.id,
    r.id,
    rs.id
  from new_stops n
  join public.content_stations s on s.slug = 'tel-aviv-port-v2-' || n.slug
  join public.content_riddles r on r.station_id = s.id and r.slug = n.slug || '-v2'
  join public.content_route_stops rs
    on rs.template_id = v_template_id and rs.version = 2 and rs.slug = n.slug
  on conflict (template_id, version, slug) do update set
    sequence_no = excluded.sequence_no,
    kind = excluded.kind,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    accessibility = excluded.accessibility,
    config = excluded.config,
    is_active = excluded.is_active,
    source_station_id = excluded.source_station_id,
    source_riddle_id = excluded.source_riddle_id,
    source_route_stop_id = excluded.source_route_stop_id;

  update public.template_versions
  set validation_report = jsonb_build_object(
        'contentChecks', 'passed',
        'fieldChecks', 'pending',
        'itemCounts', jsonb_build_object(
          'stations', (select count(*) from public.content_stations where slug like 'tel-aviv-port-v2-%'),
          'riddles', (select count(*) from public.content_riddles where slug like '%-v2'),
          'routeStops', (select count(*) from public.content_route_stops where template_id = v_template_id and version = 2),
          'checkpoints', (select count(*) from public.template_checkpoints where template_id = v_template_id and version = 2)
        )
      ),
      updated_at = now()
  where template_id = v_template_id and version = 2;
end $$;

commit;
