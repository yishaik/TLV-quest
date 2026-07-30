begin;

do $$
declare
  v_route record;
begin
  create temporary table route_defs (
    route_key text primary key,
    slug text unique,
    title jsonb,
    description jsonb,
    audience text,
    estimated_minutes integer
  ) on commit drop;

  insert into route_defs values
    ('detective', 'tel-aviv-port-sea-gate-files',
     '{"he":"תיקי שער הים","en":"The Sea Gate Files"}',
     '{"he":"חקירה בלשית בעקבות האנשים, המטענים והסודות שבנו את נמל תל אביב.","en":"A detective investigation into the people, cargo and secrets that built Tel Aviv Port."}',
     'families_and_teens', 70),
    ('creative', 'tel-aviv-port-photo-battle',
     '{"he":"קרב הפריימים של הנמל","en":"Tel Aviv Port Photo Battle"}',
     '{"he":"מסלול תחרותי של צילום, יצירתיות ועבודת צוות לאורך הדק והמעגנה.","en":"A competitive route of photography, creativity and teamwork along the deck and marina."}',
     'teens_and_adults', 65),
    ('science', 'tel-aviv-port-blue-lab',
     '{"he":"המעבדה הכחולה","en":"The Blue Lab"}',
     '{"he":"מסע מדעי קצר בעקבות גלים, רוח, מליחות, שפך נהר ואנרגיה.","en":"A compact science quest about waves, wind, salinity, an estuary and energy."}',
     'families_and_schools', 75);

  insert into public.game_templates (
    slug, brand_key, title, description, active_version, is_active
  )
  select slug, 'tlv-quest', title, description, 1, true
  from route_defs
  on conflict (slug) do update set
    title = excluded.title,
    description = excluded.description,
    is_active = excluded.is_active,
    updated_at = now();

  insert into public.template_versions (
    template_id, version, status, release_name, release_notes,
    route_config, validation_report, created_by, updated_by
  )
  select
    t.id,
    1,
    'draft',
    d.title->>'he',
    'Production-loaded route. Publish only after the documented Tel Aviv Port field-verification gate passes.',
    jsonb_build_object(
      'routeMode', 'linear',
      'audience', d.audience,
      'estimatedMinutes', d.estimated_minutes,
      'fieldVerificationRequired', true
    ),
    '{"contentChecks":"passed","fieldChecks":"pending","itemCounts":{"stations":10,"riddles":10,"routeStops":10}}'::jsonb,
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  from route_defs d
  join public.game_templates t on t.slug = d.slug
  on conflict (template_id, version) do update set
    status = 'draft',
    release_name = excluded.release_name,
    release_notes = excluded.release_notes,
    route_config = excluded.route_config,
    validation_report = excluded.validation_report,
    updated_by = excluded.updated_by,
    updated_at = now();

  create temporary table route_items (
    route_key text,
    sequence_no integer,
    station_suffix text,
    item_slug text,
    kind public.checkpoint_kind,
    title_he text,
    title_en text,
    prompt_he text,
    prompt_en text,
    success_he text,
    success_en text,
    validation jsonb,
    hint_he text,
    hint_en text,
    fallback jsonb,
    primary key (route_key, sequence_no)
  ) on commit drop;

  insert into route_items values
    ('detective',1,'south-gate-signal','case-01-trigger','choice',
     'תיק 01: הנמל שנולד במשבר','Case 01: A port born in crisis',
     'מה האיץ את הקמת נמל תל אביב ב־1936? א. שביתה והשבתת נמל יפו; ב. סערה; ג. תחרות שיט',
     'What accelerated the creation of Tel Aviv Port in 1936? A. A strike and shutdown at Jaffa Port; B. A storm; C. A sailing race',
     'החשוד הראשון זוהה: השיבוש בנמל יפו.','First lead confirmed: disruption at Jaffa Port.',
     '{"type":"choice","accepted":["א","A","a","שביתה","נמל יפו","strike","Jaffa Port"]}',
     'חפשו אירוע ששיבש את היצוא דרך יפו.','Look for an event that disrupted exports through Jaffa.',null),
    ('detective',2,'warehouse-echo','case-02-year','text',
     'תיק 02: השנה החסרה','Case 02: The missing year',
     'באיזו שנה נפתח נמל תל אביב? כתבו ארבע ספרות.','In what year did Tel Aviv Port open? Enter four digits.',
     '1936 הוחזרה לתיק החקירה.','1936 is restored to the case file.',
     '{"type":"text","accepted":["1936","שנת 1936"],"fuzzyThreshold":0.95}',
     'השנה מתחילה ב־19 ומסתיימת ב־36.','The year begins with 19 and ends with 36.',null),
    ('detective',3,'wave-deck-freeze','case-03-cargo','text',
     'תיק 03: המטען הכתום','Case 03: The orange cargo',
     'איזה פרי היה מסמלי היצוא שעבר בנמלי הארץ?','Which fruit was an iconic export through the country’s ports?',
     'התפוזים חזרו לרשימת המטענים.','Oranges are back on the cargo manifest.',
     '{"type":"text","accepted":["תפוז","תפוזים","פרי הדר","orange","oranges","citrus"],"fuzzyThreshold":0.88}',
     'המותג ההיסטורי נשא את שמה של יפו.','The historic brand carried Jaffa’s name.',null),
    ('detective',4,'marina-compass','case-04-offshore','choice',
     'תיק 04: האונייה שלא עגנה','Case 04: The ship that never docked',
     'כיצד עבר מטען מאוניות שבים לרציף הרדוד? א. דוברות; ב. רכבת; ג. מנוף אווירי',
     'How did cargo reach the shallow pier from ships offshore? A. Lighters; B. Railway; C. Aerial crane',
     'הדוברות פתרו את תעלומת ההעברה.','Lighters solve the transfer mystery.',
     '{"type":"choice","accepted":["א","A","a","דוברות","סירות מטען","lighters","cargo boats"]}',
     'הפתרון היה כלי שיט קטן.','The solution was a smaller vessel.',null),
    ('detective',5,'lighters-secret','case-05-identity','text',
     'תיק 05: הזהות העברית','Case 05: The Hebrew identity',
     'איזה כינוי היסטורי ניתן לנמל תל אביב? השלימו: הנמל ה___ הראשון.','Complete the historic description: the first ___ port.',
     'הזהות נמצאה: הנמל העברי הראשון.','Identity confirmed: the first Hebrew port.',
     '{"type":"text","accepted":["עברי","העברי","Hebrew","first Hebrew port"],"fuzzyThreshold":0.86}',
     'הכינוי קשור לשפה וליישוב העברי.','The description relates to the Hebrew-speaking Jewish community.',null),
    ('detective',6,'human-semaphore','case-06-sea','text',
     'תיק 06: הים שמולנו','Case 06: The sea before us',
     'מה שמו של הים שממערב לנמל?','What is the sea west of the port called?',
     'הים התיכון סומן במפה.','The Mediterranean is marked on the map.',
     '{"type":"text","accepted":["הים התיכון","ים תיכון","Mediterranean","Mediterranean Sea"],"fuzzyThreshold":0.88}',
     'אותו ים מחבר את ישראל, אירופה וצפון אפריקה.','This sea links Israel, Europe and North Africa.',null),
    ('detective',7,'yarkon-bridge-crossing','case-07-direction','text',
     'תיק 07: כיוון הבריחה','Case 07: The escape direction',
     'אם הים ממערב, לאיזה כיוון ממשיכים לאורך החוף כדי להגיע לרידינג?','If the sea is west, which direction along the coast leads to Reading?',
     'צפון. נתיב החשוד סומן.','North. The suspect’s route is marked.',
     '{"type":"text","accepted":["צפון","צפונה","north","N"],"fuzzyThreshold":0.9}',
     'רידינג נמצאת בהמשך החוף מעבר לנמל.','Reading lies farther along the coast beyond the port.',null),
    ('detective',8,'estuary-mixing-point','case-08-river','text',
     'תיק 08: המים הכפולים','Case 08: Two waters',
     'איזה נחל נשפך לים מצפון לנמל?','Which river reaches the sea north of the port?',
     'הירקון נוסף למפת החקירה.','The Yarkon is added to the investigation map.',
     '{"type":"text","accepted":["ירקון","הירקון","נחל הירקון","Yarkon","Yarkon River"],"fuzzyThreshold":0.88}',
     'הנחל נותן את שמו לפארק הגדול ממזרח.','The river gives its name to the large park to the east.',null),
    ('detective',9,'reading-name-code','case-09-reading','choice',
     'תיק 09: האיש בשם רידינג','Case 09: The man named Reading',
     'איזה תפקיד מילא הלורד רידינג בארץ? א. נציב עליון; ב. ראש עיר; ג. מנהל נמל',
     'Which role did Lord Reading hold in Palestine? A. High Commissioner; B. Mayor; C. Port manager',
     'נציב עליון—השם מאחורי התחנה פוענח.','High Commissioner—the name behind the station is decoded.',
     '{"type":"choice","accepted":["א","A","a","נציב עליון","High Commissioner"]}',
     'זה היה התפקיד האזרחי הבריטי הבכיר במנדט.','It was the senior British civil role during the Mandate.',null),
    ('detective',10,'time-capsule-assembly','case-10-lighthouse','text',
     'תיק 10: חותמת המגדלור','Case 10: The lighthouse seal',
     'באיזו שנה הוקם מגדלור רידינג?','In what year was Reading Lighthouse built?',
     '1935. תיק שער הים נסגר.','1935. The Sea Gate File is closed.',
     '{"type":"text","accepted":["1935","שנת 1935"],"fuzzyThreshold":0.95}',
     'שנה אחת לפני פתיחת הנמל.','One year before the port opened.',null),

    ('creative',1,'south-gate-signal','frame-01-human-logo','photo',
     'פריים 01: לוגו אנושי','Frame 01: Human logo',
     'צרו בגופכם את האותיות TLV, בלי לשכב במעבר ובלי לחסום הולכי רגל.','Form the letters TLV with your bodies without lying in a walkway or blocking pedestrians.',
     'TLV נקלט. הקרב התחיל.','TLV captured. The battle begins.',
     '{"type":"photo","criteria":"A safe group pose clearly suggesting the letters TLV without obstructing a walkway","confidenceThreshold":0.72}',
     'חלקו את הקבוצה לשלוש אותיות.','Split the team into three letters.',
     '{"type":"text","accepted":["TLV","תל אביב"],"he":"אם אי אפשר לצלם, שלחו TLV.","en":"If a photo is not possible, send TLV."}'),
    ('creative',2,'warehouse-echo','frame-02-past-present','photo',
     'פריים 02: עבר והווה','Frame 02: Past and present',
     'צלמו פריים שמציג יחד אלמנט תעשייתי ישן ואלמנט בילוי מודרני.','Capture one frame containing an old industrial element and a modern leisure element.',
     'העבר וההווה נכנסו לאותו פריים.','Past and present share one frame.',
     '{"type":"photo","criteria":"One image visibly contrasts an industrial or historic feature with a contemporary leisure feature","confidenceThreshold":0.7}',
     'חפשו קיר, מנוף או האנגר מול חנות, מסעדה או פעילות פנאי.','Look for a wall, crane or hangar beside a shop, restaurant or leisure activity.',
     '{"type":"text","accepted":["עבר והווה","past and present"],"he":"אם אי אפשר לצלם, כתבו שני פריטים שמצאתם.","en":"If a photo is not possible, name the two elements."}'),
    ('creative',3,'wave-deck-freeze','frame-03-human-wave','photo',
     'פריים 03: גל אנושי','Frame 03: Human wave',
     'צרו גל אנושי כשכל משתתף בגובה אחר. אין לטפס על מעקות.','Form a human wave with every participant at a different height. Do not climb railings.',
     'הגל שלכם קיבל ציון יצירתיות.','Your wave earns a creativity score.',
     '{"type":"photo","criteria":"A safe group pose with visibly varied heights forming a wave; no climbing","confidenceThreshold":0.76}',
     'שלבו כריעה, עמידה וידיים מורמות.','Combine crouching, standing and raised arms.',
     '{"type":"text","accepted":["גל","wave"],"he":"אם אי אפשר לצלם, שלחו גל.","en":"If a photo is not possible, send wave."}'),
    ('creative',4,'marina-compass','frame-04-mast-perspective','photo',
     'פריים 04: תופסים תורן','Frame 04: Catch a mast',
     'השתמשו בפרספקטיבה כדי לגרום לאדם להיראות כאילו הוא מחזיק תורן בכף היד.','Use forced perspective to make a teammate appear to hold a mast in one hand.',
     'הפרספקטיבה עבדה—התורן בידכם.','Perspective solved—the mast is in your hand.',
     '{"type":"photo","criteria":"A safe forced-perspective image aligning a person’s hand with a marina mast","confidenceThreshold":0.74}',
     'הצלם צריך לזוז עד שהיד והתורן מתיישרים.','The photographer should move until hand and mast align.',
     '{"type":"text","accepted":["תורן","mast"],"he":"אם אי אפשר לצלם, כתבו תורן.","en":"If a photo is not possible, send mast."}'),
    ('creative',5,'lighters-secret','frame-05-three-textures','text',
     'פריים 05: שלושה מרקמים','Frame 05: Three textures',
     'מצאו סביבכם שלושה מרקמים שונים וכתבו אותם בשלוש מילים.','Find three different textures around you and name them in three words.',
     'שלושת המרקמים נוספו ללוח ההשראה.','Three textures added to the mood board.',
     '{"type":"text","minWords":3,"maxWords":6}',
     'לדוגמה: עץ, מתכת, מים. אל תיגעו בציוד או בשטח פרטי.','For example: wood, metal, water. Do not touch equipment or private property.',null),
    ('creative',6,'human-semaphore','frame-06-signal-chain','photo',
     'פריים 06: שרשרת אותות','Frame 06: Signal chain',
     'עמדו בשורה; כל אדם מחקה את קודמו ומשנה תנוחת יד אחת.','Stand in a line; each person copies the previous pose and changes one arm position.',
     'שרשרת האותות הושלמה.','Signal chain complete.',
     '{"type":"photo","criteria":"Two or more people form a clear sequence of related arm poses in a safe open area","confidenceThreshold":0.72}',
     'התחילו מתנוחה פשוטה שקל לחקות.','Begin with a simple pose that is easy to copy.',
     '{"type":"text","accepted":["דגלים","flags"],"he":"אם אי אפשר לצלם: באמצעות מה מאותת סמפור?","en":"If a photo is not possible: what does semaphore use?"}'),
    ('creative',7,'yarkon-bridge-crossing','frame-07-reflection','photo',
     'פריים 07: השתקפות','Frame 07: Reflection',
     'צלמו השתקפות מעניינת במים, בחלון או במשטח מבריק—ממרחק בטוח מהשפה.','Capture an interesting reflection in water, glass or a shiny surface—from a safe distance.',
     'המציאות הכפולה נקלטה.','The doubled reality is captured.',
     '{"type":"photo","criteria":"A visible reflection captured from a safe public location","confidenceThreshold":0.68}',
     'לא חייבים להתקרב למים; חלון או מתכת מבריקה מתאימים.','You do not need to approach the water; glass or shiny metal works.',
     '{"type":"text","accepted":["השתקפות","reflection"],"he":"אם אי אפשר לצלם, כתבו השתקפות.","en":"If a photo is not possible, send reflection."}'),
    ('creative',8,'estuary-mixing-point','frame-08-two-worlds','photo',
     'פריים 08: שני עולמות','Frame 08: Two worlds',
     'צרו תמונה המחולקת חזותית לשניים: עיר בצד אחד וטבע בצד השני.','Create an image visually split in two: city on one side and nature on the other.',
     'העיר והטבע חולקים פריים.','City and nature share a frame.',
     '{"type":"photo","criteria":"A composed image visibly contrasts urban and natural elements","confidenceThreshold":0.7}',
     'השתמשו בקו אנכי טבעי כמו עמוד או קצה מבנה.','Use a natural vertical divider such as a post or building edge.',
     '{"type":"text","accepted":["עיר וטבע","city and nature"],"he":"אם אי אפשר לצלם, שלחו עיר וטבע.","en":"If a photo is not possible, send city and nature."}'),
    ('creative',9,'reading-name-code','frame-09-power-pose','photo',
     'פריים 09: תנוחת כוח','Frame 09: Power pose',
     'עם תחנת הכוח ברקע מרוחק, צרו יחד תנוחה שמסמלת אנרגיה. הישארו מחוץ לשטח מגודר.','With the power station in the distant background, create a group pose symbolizing energy. Stay outside fenced areas.',
     'האנרגיה הקבוצתית נטענה.','Team energy charged.',
     '{"type":"photo","criteria":"A safe group pose symbolizing energy with an industrial silhouette in the distant background","confidenceThreshold":0.68}',
     'אפשר ליצור ברק באמצעות קו ידיים משותף.','You can form a lightning bolt with a shared line of arms.',
     '{"type":"text","accepted":["אנרגיה","energy"],"he":"אם אי אפשר לצלם, שלחו אנרגיה.","en":"If a photo is not possible, send energy."}'),
    ('creative',10,'time-capsule-assembly','frame-10-postcard','text',
     'פריים 10: גלויה ל־2126','Frame 10: Postcard to 2126',
     'כתבו מסר בן 6–12 מילים לתושבי תל אביב בשנת 2126, כולל המילים ים וזיכרון.','Write a 6–12 word message to Tel Aviv residents in 2126, including sea and memory.',
     'הגלויה נשמרה. קרב הפריימים הושלם.','Postcard saved. The Photo Battle is complete.',
     '{"type":"text_constraints","requiredTerms":{"he":["ים","זיכרון"],"en":["sea","memory"]},"minWords":6,"maxWords":12}',
     'כתבו ברכה קצרה לעיר העתיד.','Write a short wish for the future city.',
     '{"type":"text","accepted":["ים זיכרון תל אביב 2126","sea memory Tel Aviv 2126"],"he":"אם הבדיקה נכשלת, שלחו: ים זיכרון תל אביב 2126","en":"If validation fails, send: sea memory Tel Aviv 2126"}'),

    ('science',1,'south-gate-signal','lab-01-salinity','choice',
     'ניסוי 01: מליחות','Experiment 01: Salinity',
     'איזה מים מלוחים יותר בדרך כלל? א. מי ים; ב. מי נהר; ג. מי גשם',
     'Which water is usually saltiest? A. Seawater; B. River water; C. Rainwater',
     'מי הים הם המלוחים ביותר מבין האפשרויות.','Seawater is the saltiest of the options.',
     '{"type":"choice","accepted":["א","A","a","מי ים","seawater","sea water"]}',
     'חשבו היכן מצטברים מלחים מומסים לאורך זמן.','Think where dissolved salts accumulate over time.',null),
    ('science',2,'warehouse-echo','lab-02-corrosion','choice',
     'ניסוי 02: מלח ומתכת','Experiment 02: Salt and metal',
     'מדוע מתכת ליד הים מחלידה מהר יותר? א. מלח ולחות מאיצים קורוזיה; ב. אור השמש צובע אותה; ג. הרוח מקפיאה אותה',
     'Why does metal rust faster near the sea? A. Salt and moisture accelerate corrosion; B. Sunlight paints it; C. Wind freezes it',
     'נכון—מלח ולחות מאיצים תגובות קורוזיה.','Correct—salt and moisture accelerate corrosion.',
     '{"type":"choice","accepted":["א","A","a","מלח ולחות","קורוזיה","salt and moisture","corrosion"]}',
     'קורוזיה היא תגובה כימית עם הסביבה.','Corrosion is a chemical reaction with the environment.',null),
    ('science',3,'wave-deck-freeze','lab-03-waves','choice',
     'ניסוי 03: מי יוצר גלים','Experiment 03: What makes waves',
     'מה יוצר את רוב הגלים שרואים בחוף ביום רגיל? א. רוח; ב. מגנטים; ג. סיבוב הירח בלבד',
     'What creates most ordinary surface waves at the beach? A. Wind; B. Magnets; C. Only the Moon’s rotation',
     'הרוח מעבירה אנרגיה לפני המים ויוצרת גלים.','Wind transfers energy to the water surface and creates waves.',
     '{"type":"choice","accepted":["א","A","a","רוח","wind"]}',
     'חפשו כוח שנוגע ישירות בפני המים.','Look for a force acting directly on the water surface.',null),
    ('science',4,'marina-compass','lab-04-buoyancy','text',
     'ניסוי 04: כוח הציפה','Experiment 04: Buoyancy',
     'איך נקרא הכוח כלפי מעלה שמאפשר לסירה לצוף?','What is the upward force that allows a boat to float called?',
     'כוח הציפה זוהה.','Buoyancy identified.',
     '{"type":"text","accepted":["ציפה","כוח הציפה","buoyancy","buoyant force"],"fuzzyThreshold":0.86}',
     'ארכימדס ניסח עיקרון מפורסם על הכוח הזה.','Archimedes described a famous principle involving this force.',null),
    ('science',5,'lighters-secret','lab-05-density','choice',
     'ניסוי 05: צפיפות','Experiment 05: Density',
     'ספינת פלדה יכולה לצוף משום ש: א. צפיפותה הממוצעת עם האוויר שבתוכה נמוכה מספיק; ב. פלדה אינה מושפעת מכבידה; ג. המנוע מושך אותה למעלה',
     'A steel ship floats because: A. Its overall density including enclosed air is low enough; B. Steel ignores gravity; C. The engine pulls it upward',
     'המבנה החלול מוריד את הצפיפות הממוצעת.','The hollow structure lowers the ship’s average density.',
     '{"type":"choice","accepted":["א","A","a","צפיפות ממוצעת","overall density","enclosed air"]}',
     'חשבו על כל נפח הספינה, לא רק על הפלדה.','Consider the ship’s whole volume, not only the steel.',null),
    ('science',6,'human-semaphore','lab-06-wind','text',
     'ניסוי 06: מד רוח אנושי','Experiment 06: Human anemometer',
     'צפו בדגל, עץ או פני המים בלי להתקרב לשפה. כתבו: חלשה, בינונית או חזקה.','Observe a flag, tree or water surface from safety. Classify the wind: light, moderate or strong.',
     'מדידת הרוח נרשמה ביומן המעבדה.','Wind observation recorded in the lab log.',
     '{"type":"text","accepted":["חלשה","בינונית","חזקה","light","moderate","strong"],"fuzzyThreshold":0.84}',
     'הסתמכו על תנועה נראית, לא על תחושה בלבד.','Use visible motion, not only how the wind feels.',null),
    ('science',7,'yarkon-bridge-crossing','lab-07-river','text',
     'ניסוי 07: זיהוי הנחל','Experiment 07: Identify the river',
     'איזה נחל פוגש כאן את הים התיכון?','Which river meets the Mediterranean here?',
     'הירקון זוהה.','The Yarkon identified.',
     '{"type":"text","accepted":["ירקון","הירקון","נחל הירקון","Yarkon","Yarkon River"],"fuzzyThreshold":0.88}',
     'הוא נותן את שמו לפארק הגדול ממזרח.','It gives its name to the large park to the east.',null),
    ('science',8,'estuary-mixing-point','lab-08-estuary','choice',
     'ניסוי 08: שפך נהר','Experiment 08: Estuary',
     'מה קורה בשפך? א. מים מתוקים ומלוחים יכולים להתערבב; ב. המים נעלמים; ג. הנהר מתחיל בהרים',
     'What happens at an estuary? A. Fresh and salt water can mix; B. Water disappears; C. The river begins in mountains',
     'נכון—השפך הוא אזור מפגש דינמי בין מים מתוקים למלוחים.','Correct—the estuary is a dynamic meeting zone of fresh and salt water.',
     '{"type":"choice","accepted":["א","A","a","מתוקים ומלוחים","fresh and salt water","mix"]}',
     'זהו סוף מסלול הנהר, במקום מפגש עם הים.','It is the river’s end where it meets the sea.',null),
    ('science',9,'reading-name-code','lab-09-energy','choice',
     'ניסוי 09: שרשרת אנרגיה','Experiment 09: Energy chain',
     'בתחנת כוח תרמית, מהו סדר ההמרה העיקרי? א. כימית→חום→תנועה→חשמל; ב. חשמל→כימית בלבד; ג. אור→קול',
     'In a thermal power station, what is the main conversion chain? A. Chemical→heat→motion→electricity; B. Electricity→chemical only; C. Light→sound',
     'שרשרת ההמרה פוענחה.','The conversion chain is decoded.',
     '{"type":"choice","accepted":["א","A","a","כימית חום תנועה חשמל","chemical heat motion electricity"]}',
     'החום יוצר קיטור, הקיטור מסובב טורבינה.','Heat makes steam; steam turns a turbine.',null),
    ('science',10,'time-capsule-assembly','lab-10-blue-pledge','text',
     'ניסוי 10: התחייבות כחולה','Experiment 10: Blue pledge',
     'כתבו פעולה אחת שהקבוצה מתחייבת לעשות כדי לצמצם פסולת שמגיעה לים.','Write one action your team commits to taking to reduce waste reaching the sea.',
     'ההתחייבות נשמרה. המעבדה הכחולה הושלמה.','Pledge saved. The Blue Lab is complete.',
     '{"type":"text","minWords":2,"maxWords":20}',
     'בחרו פעולה מדידה: בקבוק רב־פעמי, איסוף פסולת או פחות פלסטיק חד־פעמי.','Choose a measurable action: reusable bottle, litter pickup or less single-use plastic.',null);

  insert into public.content_riddles (
    station_id, slug, title, kind, content, validation, hints, scoring,
    fallback, interaction, tags, status, created_by, updated_by
  )
  select
    s.id,
    i.item_slug,
    jsonb_build_object('he', i.title_he, 'en', i.title_en),
    i.kind,
    jsonb_build_object(
      'he', jsonb_build_object(
        'title', i.title_he,
        'story', case i.route_key
          when 'detective' then 'פתחו תיק חקירה חדש ואספו את הראיה הבאה.'
          when 'creative' then 'כל תחנה מעניקה הזדמנות לפריים מקורי ובטוח.'
          else 'בצעו תצפית קצרה והוסיפו ממצא ליומן המעבדה.'
        end,
        'prompt', i.prompt_he,
        'locationHint', 'הישארו במרחב הציבורי, אל תחסמו מעבר ואל תיכנסו לשטח מגודר.',
        'success', i.success_he
      ),
      'en', jsonb_build_object(
        'title', i.title_en,
        'story', case i.route_key
          when 'detective' then 'Open a new case file and collect the next piece of evidence.'
          when 'creative' then 'Every stop is a chance for an original and safe frame.'
          else 'Make a short observation and add a finding to the lab log.'
        end,
        'prompt', i.prompt_en,
        'locationHint', 'Remain in public space, do not block passage and never enter fenced areas.',
        'success', i.success_en
      )
    ),
    i.validation,
    jsonb_build_array(jsonb_build_object('he',i.hint_he,'en',i.hint_en,'penalty',case when i.kind='photo' then 5 else 10 end)),
    jsonb_build_object(
      'basePoints', case when i.kind='photo' then 120 else 100 end,
      'wrongPenalty', case when i.kind='photo' then 0 else 5 end,
      'hintPenalty', case when i.kind='photo' then 5 else 10 end,
      'speedBonusMax', 20,
      'speedBonusWindowSeconds', 420
    ),
    i.fallback,
    jsonb_build_object(
      'primary', case when i.kind='photo' then 'photo' else 'web_or_whatsapp' end,
      'acceptWhatsAppMedia', i.kind='photo',
      'webFallback', true
    ),
    array['tel-aviv-port',i.route_key,'route-v1','bilingual']::text[],
    'active',
    'codex-content-2026-07-30',
    'codex-content-2026-07-30'
  from route_items i
  join public.content_stations s
    on s.slug = 'tel-aviv-port-v2-' || i.station_suffix
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

  for v_route in
    select d.route_key, t.id as template_id
    from route_defs d
    join public.game_templates t on t.slug = d.slug
  loop
    insert into public.content_route_stops (
      template_id, version, station_id, riddle_id, slug, sequence_no,
      is_optional, is_active, overrides, created_by, updated_by
    )
    select
      v_route.template_id,
      1,
      s.id,
      r.id,
      i.item_slug,
      i.sequence_no,
      false,
      true,
      '{}'::jsonb,
      'codex-content-2026-07-30',
      'codex-content-2026-07-30'
    from route_items i
    join public.content_stations s
      on s.slug = 'tel-aviv-port-v2-' || i.station_suffix
    join public.content_riddles r
      on r.station_id = s.id and r.slug = i.item_slug
    where i.route_key = v_route.route_key
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
      v_route.template_id,
      1,
      i.item_slug,
      i.sequence_no,
      i.kind,
      s.latitude,
      s.longitude,
      s.radius_meters,
      s.accessibility,
      jsonb_build_object(
        'content', r.content,
        'validation', r.validation,
        'hints', r.hints,
        'scoring', r.scoring,
        'fallback', r.fallback,
        'interaction', r.interaction,
        'field_verification_required', true
      ),
      false,
      true,
      s.id,
      r.id,
      rs.id
    from route_items i
    join public.content_stations s
      on s.slug = 'tel-aviv-port-v2-' || i.station_suffix
    join public.content_riddles r
      on r.station_id = s.id and r.slug = i.item_slug
    join public.content_route_stops rs
      on rs.template_id = v_route.template_id
     and rs.version = 1
     and rs.slug = i.item_slug
    where i.route_key = v_route.route_key
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
  end loop;

  update public.template_versions tv
  set validation_report = jsonb_build_object(
        'contentChecks','passed',
        'fieldChecks','pending',
        'itemCounts',jsonb_build_object(
          'stations',10,
          'riddles',(select count(*) from public.content_route_stops rs where rs.template_id=tv.template_id and rs.version=1),
          'routeStops',(select count(*) from public.content_route_stops rs where rs.template_id=tv.template_id and rs.version=1),
          'checkpoints',(select count(*) from public.template_checkpoints tc where tc.template_id=tv.template_id and tc.version=1)
        )
      ),
      updated_at = now()
  where tv.version=1
    and tv.template_id in (
      select t.id from route_defs d join public.game_templates t on t.slug=d.slug
    );
end $$;

commit;
