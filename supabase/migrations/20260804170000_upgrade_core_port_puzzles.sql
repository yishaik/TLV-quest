begin;

-- Replace giveaway distractors in the core time-capsule route with questions
-- that require chronology and physical reasoning. Published runs remain
-- immutable snapshots; these changes affect the library and future runs.
create temporary table puzzle_upgrade (
  slug text primary key,
  prompt_he text,
  prompt_en text,
  validation jsonb,
  hints jsonb
) on commit drop;

insert into puzzle_upgrade values
  (
    'south-gate-signal-v2',
    'בארכיון מופיעים שלושה רישומים: מגדלור רידינג הושלם ב־1935; נמל יפו הושבת באפריל 1936; מזח תל אביב נפתח במאי 1936. איזה רישום מסביר בצורה הטובה ביותר מדוע היה צורך לפתוח את המזח במהירות? א. השבתת נמל יפו; ב. השלמת המגדלור; ג. תכנית תיירות עירונית',
    'The archive shows three records: Reading Lighthouse was completed in 1935; Jaffa Port shut down in April 1936; Tel Aviv pier opened in May 1936. Which record best explains the urgent opening? A. Jaffa Port shutdown; B. Lighthouse completion; C. A city tourism plan',
    '{"type":"choice","accepted":["א","א.","A","a","השבתת נמל יפו","Jaffa Port shutdown","strike"]}',
    '[{"he":"חפשו את האירוע שקרה ממש לפני פתיחת המזח ושיבש נתיב קיים.","en":"Look for the event immediately before the pier opened that disrupted an existing route.","penalty":10}]'
  ),
  (
    'lighters-secret-v2',
    'האוניות הגדולות נשארו במים עמוקים, אבל המטען היה חייב להגיע לרציף רדוד—בלי להעמיק את כל אגן הנמל. איזה פתרון מתאים לשני התנאים? א. מסוע קבוע מן החוף; ב. דוברות וסירות מטען קטנות; ג. גרירת האונייה על החול',
    'Large ships stayed in deep water, but cargo had to reach a shallow pier—without deepening the whole basin. Which solution satisfies both constraints? A. A fixed shore conveyor; B. Small lighters and cargo boats; C. Dragging the ship over sand',
    '{"type":"choice","accepted":["ב","ב.","B","b","דוברות","סירות מטען","lighters","cargo boats"]}',
    '[{"he":"הפתרון צריך לנוע בין מים עמוקים לרדודים ולשאת מטען.","en":"The solution must move between deep and shallow water while carrying cargo.","penalty":10}]'
  ),
  (
    'estuary-mixing-point-v2',
    'בנקודה הזאת המליחות יכולה להשתנות עם זרימת הנחל והגאות. איזה תהליך מסביר את השינוי? א. ערבוב מים מתוקים ומי ים בשפך; ב. התאדות מי הים בלבד; ג. היעלמות הנהר מתחת לקרקע',
    'Salinity here can change with river flow and the tide. Which process explains it? A. Fresh and salt water mixing at the river mouth; B. Seawater evaporation alone; C. The river disappearing underground',
    '{"type":"choice","accepted":["א","א.","A","a","ערבוב מים מתוקים ומי ים","fresh and salt water mixing","mix"]}',
    '[{"he":"חשבו אילו שני מקורות מים נפגשים כאן, ומה הגאות יכולה להזיז.","en":"Consider the two water sources meeting here and what the tide can move.","penalty":10}]'
  );

update public.content_riddles r
set
  content = jsonb_set(
    jsonb_set(r.content, '{he,prompt}', to_jsonb(u.prompt_he), true),
    '{en,prompt}', to_jsonb(u.prompt_en), true
  ),
  validation = u.validation,
  hints = u.hints,
  tags = array(select distinct unnest(coalesce(r.tags, '{}'::text[]) || array['field-reasoning','pilot-v3'])),
  updated_at = now(),
  updated_by = 'codex-experience-2026-08-04'
from puzzle_upgrade u
where r.slug = u.slug;

update public.template_checkpoints tc
set config = jsonb_set(
  jsonb_set(
    jsonb_set(tc.config, '{content}', r.content, true),
    '{validation}', r.validation, true
  ),
  '{hints}', r.hints, true
)
from public.content_riddles r
where tc.source_riddle_id = r.id
  and r.slug in (select slug from puzzle_upgrade);

commit;
