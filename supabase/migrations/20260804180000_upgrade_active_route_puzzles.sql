begin;

-- Production's active route library predates the content-v2 slugs. Apply the
-- field-reasoning upgrades to the equivalent active checkpoints.
update public.template_checkpoints
set config = jsonb_set(
  jsonb_set(config, '{content,he,prompt}', to_jsonb('בארכיון מופיעים שלושה רישומים: מגדלור רידינג הושלם ב־1935; נמל יפו הושבת באפריל 1936; מזח תל אביב נפתח במאי 1936. איזה רישום מסביר בצורה הטובה ביותר מדוע היה צורך לפתוח את המזח במהירות? א. השבתת נמל יפו; ב. השלמת המגדלור; ג. תכנית תיירות עירונית'::text), true),
  '{validation}', '{"type":"choice","accepted":["א","א.","A","a","השבתת נמל יפו","Jaffa Port shutdown","strike"]}'::jsonb, true
)
where slug = 'case-01-trigger';

update public.template_checkpoints
set config = jsonb_set(
  jsonb_set(config, '{content,he,prompt}', to_jsonb('האוניות הגדולות נשארו במים עמוקים, אבל המטען היה חייב להגיע לרציף רדוד—בלי להעמיק את כל אגן הנמל. איזה פתרון מתאים לשני התנאים? א. מסוע קבוע מן החוף; ב. דוברות וסירות מטען קטנות; ג. גרירת האונייה על החול'::text), true),
  '{validation}', '{"type":"choice","accepted":["ב","ב.","B","b","דוברות","סירות מטען","lighters","cargo boats"]}'::jsonb, true
)
where slug = 'case-04-offshore';

update public.template_checkpoints
set config = jsonb_set(
  jsonb_set(config, '{content,he,prompt}', to_jsonb('בנקודה הזאת המליחות יכולה להשתנות עם זרימת הנחל והגאות. איזה תהליך מסביר את השינוי? א. ערבוב מים מתוקים ומי ים בשפך; ב. התאדות מי הים בלבד; ג. היעלמות הנהר מתחת לקרקע'::text), true),
  '{validation}', '{"type":"choice","accepted":["א","א.","A","a","ערבוב מים מתוקים ומי ים","fresh and salt water mixing","mix"]}'::jsonb, true
)
where slug = 'lab-08-estuary';

commit;
