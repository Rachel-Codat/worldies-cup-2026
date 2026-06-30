/* Reads matches.json (football-data.org WC feed) + the tracker HTML,
   rewrites the RESULTS:START..END block, writes the HTML back.
   Usage: node generate.js <matches.json> <tracker.html> */
const fs = require("fs");
const [,, matchesPath, htmlPath] = process.argv;

// API name -> sweepstake canonical name
const ALIAS = {
  "Czechia": "Czech Republic",
  "Bosnia-Herzegovina": "Bosnia and Herzegovina",
  "South Korea": "Korea Republic",
  "Ivory Coast": "Côte d'Ivoire",
};
const canon = n => (n == null ? null : (ALIAS[n] || n));

const SWEEP = ["Germany","Turkey","France","Colombia","Argentina","Paraguay","Curaçao","Ghana","South Africa","Austria","Saudi Arabia","Algeria","Czech Republic","Iran","Bosnia and Herzegovina","Sweden","United States","Morocco","Mexico","Belgium","Netherlands","Iraq","Korea Republic","Haiti","Qatar","New Zealand","Cape Verde Islands","Egypt","Australia","Norway","Tunisia","Congo DR","Japan","Spain","Portugal","Uzbekistan","Switzerland","Panama","Scotland","Jordan","Senegal","Côte d'Ivoire","England","Croatia","Uruguay","Canada","Brazil","Ecuador"];
const SWEEP_SET = new Set(SWEEP);

const STAGE_TO_ROUND = {
  LAST_32: "Round of 32",
  LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  FINAL: "Final",
};
const ROUND_ORDER = ["Round of 32","Round of 16","Quarter-finals","Semi-finals","Final"];
const KO_STAGES = new Set(Object.keys(STAGE_TO_ROUND).concat(["THIRD_PLACE"]));

const data = JSON.parse(fs.readFileSync(matchesPath, "utf8"));
const matches = data.matches || [];
const FINISHED = new Set(["FINISHED","AWARDED"]);

const winnerName = m => {
  if (!FINISHED.has(m.status)) return null;
  const w = m.score && m.score.winner;
  if (w === "HOME_TEAM") return canon(m.homeTeam.name);
  if (w === "AWAY_TEAM") return canon(m.awayTeam.name);
  return null; // draw shouldn't happen in KO; group draws irrelevant here
};

// --- bracket ---
const bracket = ROUND_ORDER.map(r => ({ name: r, matches: [] }));
const roundIdx = Object.fromEntries(ROUND_ORDER.map((r,i)=>[r,i]));
matches
  .filter(m => STAGE_TO_ROUND[m.stage])
  .sort((a,b) => new Date(a.utcDate) - new Date(b.utcDate) || a.id - b.id)
  .forEach(m => {
    const round = STAGE_TO_ROUND[m.stage];
    bracket[roundIdx[round]].matches.push({
      a: canon(m.homeTeam && m.homeTeam.name),
      b: canon(m.awayTeam && m.awayTeam.name),
      w: winnerName(m),
    });
  });

// --- eliminations ---
// Teams that reached any knockout match = the 32 that survived the groups.
const reachedKO = new Set();
matches.filter(m => KO_STAGES.has(m.stage)).forEach(m => {
  if (m.homeTeam && m.homeTeam.name) reachedKO.add(canon(m.homeTeam.name));
  if (m.awayTeam && m.awayTeam.name) reachedKO.add(canon(m.awayTeam.name));
});
const groupsDone = matches.filter(m => m.stage === "GROUP_STAGE")
  .every(m => FINISHED.has(m.status));

const eliminated = new Set();
// group-stage exits (only once groups are complete and we actually have KO teams)
if (groupsDone && reachedKO.size > 0) {
  SWEEP.forEach(t => { if (!reachedKO.has(t)) eliminated.add(t); });
}
// knockout losers
matches.filter(m => KO_STAGES.has(m.stage) && FINISHED.has(m.status)).forEach(m => {
  const w = winnerName(m);
  [m.homeTeam, m.awayTeam].forEach(t => {
    const nm = canon(t && t.name);
    if (nm && nm !== w) eliminated.add(nm);
  });
});
const elimSweep = [...eliminated].filter(t => SWEEP_SET.has(t)).sort();

// --- champion ---
const finalM = matches.find(m => m.stage === "FINAL");
const champion = finalM ? winnerName(finalM) : null;

// --- status line + version ---
let currentRound = "Group stage";
for (const r of ROUND_ORDER) {
  const ms = bracket[roundIdx[r]].matches;
  if (ms.length && ms.some(x => x.w)) currentRound = r; // most advanced round with a result
}
if (champion) currentRound = "Champions crowned";
const lastFinished = matches.filter(m => FINISHED.has(m.status))
  .map(m => m.lastUpdated || m.utcDate).sort().pop();
const stamp = (lastFinished || new Date().toISOString()).slice(0,10);
const fmt = d => { const [y,mo,da]=d.split("-"); const M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${+da} ${M[+mo-1]} ${y}`; };
const status = `${currentRound} · updated ${fmt(stamp)}`;
const version = "v" + stamp + "-" + matches.filter(m=>FINISHED.has(m.status)).length;

// --- emit block ---
const j = v => JSON.stringify(v);
const bracketLines = bracket.map(r =>
  `  { name:${j(r.name)}, matches:${j(r.matches)} }`).join(",\n");
const block =
`/* === RESULTS:START — auto-generated from football-data.org; do not hand-edit === */
const DATA_VERSION = ${j(version)};
const STATUS = ${j(status)};
const CHAMPION = ${j(champion)};
const ELIMINATED_DEFAULT = ${j(elimSweep)};
const BRACKET = [
${bracketLines}
];
/* === RESULTS:END === */`;

let html = fs.readFileSync(htmlPath, "utf8");
const re = /\/\* === RESULTS:START[\s\S]*?=== RESULTS:END === \*\//;
if (!re.test(html)) { console.error("RESULTS markers not found in HTML"); process.exit(1); }
html = html.replace(re, block);
fs.writeFileSync(htmlPath, html);

console.log("STATUS:", status);
console.log("VERSION:", version);
console.log("CHAMPION:", champion);
console.log("ELIMINATED (sweepstake teams):", elimSweep.length, "->", elimSweep.join(", ") || "(none)");
console.log("reachedKO count:", reachedKO.size, "| groupsDone:", groupsDone);
bracket.forEach(r => console.log(`  ${r.name}: ${r.matches.length} matches, ${r.matches.filter(x=>x.w).length} decided`));
