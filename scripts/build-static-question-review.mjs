import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = process.argv[2] || "/tmp/tlv-question-review";
const read = (name) => readFileSync(resolve(root, name), "utf8");

function tuplesBetween(sql, start, end) {
  const source = sql.slice(sql.indexOf(start) + start.length, sql.indexOf(end, sql.indexOf(start)));
  const tuples = [];
  let quote = false, depth = 0, current = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "'" && quote && source[i + 1] === "'") { current += "''"; i++; continue; }
    if (char === "'") quote = !quote;
    if (!quote && char === "(") { if (depth++ === 0) { current = ""; continue; } }
    if (!quote && char === ")") { if (--depth === 0) { tuples.push(current); current = ""; continue; } }
    if (depth > 0) current += char;
  }
  return tuples;
}

function fields(tuple) {
  const result = []; let quote = false, depth = 0, current = "";
  for (let i = 0; i < tuple.length; i++) {
    const char = tuple[i];
    if (char === "'" && quote && tuple[i + 1] === "'") { current += "''"; i++; continue; }
    if (char === "'") quote = !quote;
    if (!quote && ["(", "[", "{"].includes(char)) depth++;
    if (!quote && [")", "]", "}"].includes(char)) depth--;
    if (!quote && depth === 0 && char === ",") { result.push(value(current)); current = ""; continue; }
    current += char;
  }
  result.push(value(current)); return result;
}

function value(raw) {
  const trimmed = raw.trim();
  if (/^null$/i.test(trimmed)) return null;
  if (trimmed.startsWith("'") && trimmed.lastIndexOf("'") > 0) {
    return trimmed.slice(1, trimmed.lastIndexOf("'")).replaceAll("''", "'");
  }
  const numeric = Number(trimmed); return Number.isFinite(numeric) ? numeric : trimmed;
}
const json = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

const routesSql = read("supabase/migrations/20260730143000_add_three_port_routes.sql");
const routeNames = { detective: "תיקי שער הים", creative: "קרב הפריימים של הנמל", science: "המעבדה הכחולה" };
const routes = Object.entries(routeNames).map(([key, title]) => ({ key, title, stops: [] }));
for (const tuple of tuplesBetween(routesSql, "insert into route_items values", "insert into public.content_riddles")) {
  const f = fields(tuple); const route = routes.find((item) => item.key === f[0]);
  if (!route || typeof f[1] !== "number") continue;
  const validation = json(f[11]); const fallback = json(f[15], null);
  route.stops.push({ sequence: f[1], kind: f[4], title: f[5], prompt: f[7], success: f[9], validation,
    hints: f[13] ? [{ he: f[13] }] : [], fallback });
}

const capsuleSql = read("supabase/migrations/20260730130000_expand_port_quest_v2.sql");
const capsule = { key: "capsule", title: "קפסולת הזמן של נמל תל אביב", stops: [] };
for (const tuple of tuplesBetween(capsuleSql, "insert into new_stops values", "insert into public.content_stations")) {
  const f = fields(tuple); if (typeof f[0] !== "number") continue;
  const content = json(f[8]);
  capsule.stops.push({ sequence: f[0], kind: f[2], title: content.he?.title || "", prompt: content.he?.prompt || "",
    success: content.he?.success || "", validation: json(f[9]), hints: json(f[10], []), fallback: json(f[12], null) });
}
routes.push(capsule);
routes.forEach((route) => route.stops.sort((a, b) => a.sequence - b.sequence));

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const accepted = (validation) => Array.isArray(validation.accepted) ? validation.accepted.join(" · ") : validation.acceptedOption || "";
const cards = routes.map((route, routeIndex) => `<section class="route" data-route="${routeIndex}"><div class="route-title"><span>מסלול ${String(routeIndex + 1).padStart(2, "0")}</span><h2>${esc(route.title)}</h2><b>${route.stops.length} תחנות</b></div>${route.stops.map((stop) => `<article class="card" data-search="${esc(JSON.stringify(stop))}">
<button class="head" onclick="this.parentElement.classList.toggle('open')"><i>${String(stop.sequence).padStart(2, "0")}</i><span><small>${esc(stop.kind)}</small><strong>${esc(stop.title)}</strong></span><em>⌄</em></button>
<div class="body"><div class="question"><label>השאלה או המשימה</label><p>${esc(stop.prompt)}</p></div>
<div class="grid"><div><label>תשובות מתקבלות</label><p>${esc(accepted(stop.validation) || (stop.kind === "photo" ? "אישור תמונה לפי הקריטריון" : "תשובה פתוחה לפי התנאים"))}</p></div>
${stop.validation.criteria ? `<div><label>קריטריון צילום</label><p>${esc(stop.validation.criteria)}</p></div>` : ""}
${stop.validation.minParticipants ? `<div><label>מינימום משתתפים</label><p>${esc(stop.validation.minParticipants)}</p></div>` : ""}</div>
${stop.hints?.length ? `<div class="hints"><label>רמזים</label>${stop.hints.map((hint, i) => `<p><b>${i + 1}</b>${esc(hint.he)}${hint.penalty ? `<small>−${hint.penalty} נק׳</small>` : ""}</p>`).join("")}</div>` : ""}
${stop.fallback?.he ? `<div class="fallback"><label>חלופת גיבוי</label><p>${esc(stop.fallback.he)}</p><small>מתקבל: ${esc((stop.fallback.accepted || []).join(" · ") || "לפי התנאים")}</small></div>` : ""}
<div><label>הודעת הצלחה</label><p>${esc(stop.success)}</p></div></div></article>`).join("")}</section>`).join("");

const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>בדיקת שאלות · TLV Quest</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1ede4;color:#17231e;font-family:Arial,sans-serif}.page{max-width:1180px;margin:auto;padding:50px 24px 100px}header{border-bottom:1px solid #c7beaf;padding-bottom:30px}header small{color:#c35a37;letter-spacing:.18em;font-weight:900}h1{font-size:clamp(42px,7vw,82px);line-height:.92;letter-spacing:-.06em;margin:14px 0 22px;max-width:850px}header p{color:#66706b;font-size:17px}.tools{position:sticky;top:0;z-index:5;background:#f1ede4eF;backdrop-filter:blur(12px);display:grid;grid-template-columns:2fr 1fr auto;gap:10px;padding:20px 0}.tools input,.tools select,.tools button{height:48px;border:1px solid #c9c0b2;border-radius:10px;background:#fffaf1;padding:0 15px;font:inherit}.tools button{background:#17231e;color:white;cursor:pointer}.route{margin-top:38px}.route-title{display:grid;grid-template-columns:1fr auto;align-items:end;margin-bottom:14px}.route-title span{grid-column:1/-1;font-size:11px;color:#c35a37;font-weight:900;letter-spacing:.13em}.route-title h2{font-size:32px;margin:5px 0}.route-title b{color:#7a817d}.card{background:#fffaf1;border:1px solid #d5ccbe;border-radius:14px;margin:9px 0;overflow:hidden}.head{width:100%;display:grid;grid-template-columns:55px 1fr 30px;align-items:center;text-align:right;border:0;background:none;padding:18px 20px;color:inherit;cursor:pointer}.head i{font:14px monospace;color:#c35a37}.head span{display:grid;gap:4px}.head small{color:#818681}.head strong{font-size:20px}.head em{font-size:22px;transition:.2s}.open .head em{transform:rotate(180deg)}.body{display:none;border-top:1px solid #e3dbcf;padding:24px 74px 28px 48px;gap:18px}.open .body{display:grid}label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.11em;font-weight:900;color:#858a85;margin-bottom:7px}.body p{margin:0;line-height:1.6}.question{border-right:4px solid #c35a37;background:#f7ece2;border-radius:8px;padding:14px 17px}.question p{font-size:19px;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid>div{border:1px solid #dfd7ca;border-radius:9px;padding:14px}.hints{background:#e9eee6;padding:16px;border-radius:9px}.hints p{display:grid;grid-template-columns:28px 1fr auto;gap:8px;margin:8px 0}.hints b{background:#216556;color:white;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px}.hints small{color:#946957}.fallback{background:#17231e;color:white;padding:17px;border-radius:9px}.fallback label{color:#ee9a73}.fallback small{color:#aeb9b3}.hidden{display:none!important}@media(max-width:650px){.page{padding:30px 13px 70px}.tools{grid-template-columns:1fr}.body{padding:20px}.grid{grid-template-columns:1fr}.head{padding:15px 13px;grid-template-columns:40px 1fr 24px}.head strong{font-size:17px}}@media print{.tools{display:none}.body{display:grid}.card{break-inside:avoid}}
</style></head><body><main class="page"><header><small>TLV QUEST · בקרת תוכן</small><h1>כל השאלות. בלי הפתעות בשטח.</h1><p>שאלות, תשובות מתקבלות, רמזים, קריטריוני צילום וחלופות — לפי מסלול ותחנה.</p></header><div class="tools"><input id="search" placeholder="חיפוש שאלה, תשובה או רמז…"><select id="route"><option value="all">כל המסלולים</option>${routes.map((r,i)=>`<option value="${i}">${esc(r.title)}</option>`).join("")}</select><button id="toggle">פתיחת הכול</button></div>${cards}</main><script>
const q=document.querySelector('#search'),sel=document.querySelector('#route'),toggle=document.querySelector('#toggle');function filter(){const n=q.value.trim().toLowerCase();document.querySelectorAll('.route').forEach(r=>{const routeOk=sel.value==='all'||r.dataset.route===sel.value;let visible=0;r.querySelectorAll('.card').forEach(c=>{const ok=routeOk&&(!n||c.dataset.search.toLowerCase().includes(n));c.classList.toggle('hidden',!ok);if(ok)visible++});r.classList.toggle('hidden',!visible)})}q.oninput=filter;sel.onchange=filter;toggle.onclick=()=>{const cards=[...document.querySelectorAll('.card:not(.hidden)')],open=cards.every(c=>c.classList.contains('open'));cards.forEach(c=>c.classList.toggle('open',!open));toggle.textContent=open?'פתיחת הכול':'סגירת הכול'};
</script></body></html>`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "index.html"), html);
console.log(output);
