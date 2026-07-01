/* Reads matches.json (football-data.org WC feed), rewrites the RESULTS:START..END
   block in the tracker HTML, and writes data.json (polled live by the page).
   Usage: node build/generate.js <matches.json> <tracker.html> */
const fs = require("fs");
const path = require("path");
const [,, matchesPath, htmlPath, publishedPath] = process.argv;

const writeDeployNeededOutput = deployNeeded => {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) fs.appendFileSync(githubOutput, `changed=${deployNeeded}\n`);
};
const resultsFingerprintExcludingTimestamp = s => JSON.stringify({
  round: s.round, anyLive: s.anyLive, champion: s.champion,
  eliminated: s.eliminated, bracket: s.bracket,
});

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

const FINISHED = new Set(["FINISHED","AWARDED"]);
const LIVE = new Set(["IN_PLAY"]);
const PAUSED = new Set(["PAUSED"]);

let matches = [];
try {
  matches = (JSON.parse(fs.readFileSync(matchesPath, "utf8")).matches) || [];
} catch (e) {
  console.warn("WARN: could not read/parse matches feed:", e.message);
}

const stOf = s => FINISHED.has(s) ? "FT" : LIVE.has(s) ? "LIVE" : PAUSED.has(s) ? "HT" : "sched";
const winnerName = m => {
  if (!FINISHED.has(m.status)) return null;
  const w = m.score && m.score.winner;
  if (w === "HOME_TEAM") return canon(m.homeTeam.name);
  if (w === "AWAY_TEAM") return canon(m.awayTeam.name);
  return null;
};

const dataPath = path.join(path.dirname(htmlPath), "data.json");
const priorFinishedByFixture = {};
try {
  JSON.parse(fs.readFileSync(dataPath, "utf8")).bracket.forEach(r => r.matches.forEach(m => {
    if (m.st === "FT" && m.sa != null && m.sb != null && m.a && m.b) {
      priorFinishedByFixture[m.a + "|" + m.b] = m;
    }
  }));
} catch (e) {}

// --- bracket (with scores / live status / kickoff) ---
const roundIdx = Object.fromEntries(ROUND_ORDER.map((r,i)=>[r,i]));
const bracket = ROUND_ORDER.map(r => ({ name: r, matches: [] }));
matches
  .filter(m => STAGE_TO_ROUND[m.stage])
  .sort((a,b) => new Date(a.utcDate) - new Date(b.utcDate) || a.id - b.id)
  .forEach(m => {
    const ft = (m.score && m.score.fullTime) || {};
    const rt = (m.score && m.score.regularTime) || {};
    const et = (m.score && m.score.extraTime) || {};
    const pen = (m.score && m.score.penalties) || {};
    const isPenaltyShootout = m.score && m.score.duration === "PENALTY_SHOOTOUT" && pen.home != null;
    const regulationGoals = side => {
      if (isPenaltyShootout) {
        if (rt[side] != null) return rt[side] + (et[side] != null ? et[side] : 0);
        if (ft[side] != null && pen[side] != null) return ft[side] - pen[side];
      }
      return ft[side] != null ? ft[side] : null;
    };
    bracket[roundIdx[STAGE_TO_ROUND[m.stage]]].matches.push({
      a: canon(m.homeTeam && m.homeTeam.name),
      b: canon(m.awayTeam && m.awayTeam.name),
      w: winnerName(m),
      sa: regulationGoals("home"),
      sb: regulationGoals("away"),
      pa: isPenaltyShootout ? pen.home : null,
      pb: isPenaltyShootout ? pen.away : null,
      st: stOf(m.status),
      ko: m.utcDate || null,
    });
  });

bracket.forEach(r => r.matches.forEach(m => {
  const prior = (m.st !== "FT" && m.a && m.b) ? priorFinishedByFixture[m.a + "|" + m.b] : null;
  if (prior) {
    m.sa = prior.sa; m.sb = prior.sb; m.pa = prior.pa; m.pb = prior.pb;
    m.w = prior.w; m.st = "FT";
  }
}));

// --- eliminations ---
const reachedKO = new Set();
matches.filter(m => KO_STAGES.has(m.stage)).forEach(m => {
  if (m.homeTeam && m.homeTeam.name) reachedKO.add(canon(m.homeTeam.name));
  if (m.awayTeam && m.awayTeam.name) reachedKO.add(canon(m.awayTeam.name));
});
const groupsDone = matches.filter(m => m.stage === "GROUP_STAGE").every(m => FINISHED.has(m.status));

const eliminated = new Set();
if (groupsDone && reachedKO.size > 0) SWEEP.forEach(t => { if (!reachedKO.has(t)) eliminated.add(t); });
matches.filter(m => KO_STAGES.has(m.stage) && FINISHED.has(m.status)).forEach(m => {
  const w = winnerName(m);
  [m.homeTeam, m.awayTeam].forEach(t => {
    const nm = canon(t && t.name);
    if (nm && nm !== w) eliminated.add(nm);
  });
});
bracket.forEach(r => r.matches.forEach(m => {
  if (m.st === "FT" && m.w) [m.a, m.b].forEach(t => { if (t && t !== m.w) eliminated.add(t); });
}));
const elimSweep = [...eliminated].filter(t => SWEEP_SET.has(t)).sort();

// --- champion / round / live ---
const finalM = matches.find(m => m.stage === "FINAL");
const champion = finalM ? winnerName(finalM) : null;

let round = "Round of 32";
ROUND_ORDER.forEach(r => { if (bracket[roundIdx[r]].matches.some(x => x.st !== "sched")) round = r; });
if (champion) round = "Champions crowned";

const anyLive = matches.some(m => LIVE.has(m.status) || PAUSED.has(m.status));
const generatedAt = new Date().toISOString();
const version = "v" + generatedAt.slice(0,16) + "-" + matches.filter(m => FINISHED.has(m.status)).length;

// Guard: if the feed gave us no knockout matches (API empty, restricted, or
// failed), keep the existing committed data rather than wiping the site.
const koCount = bracket.reduce((n, r) => n + r.matches.length, 0);
if (koCount === 0) {
  console.warn("WARN: feed returned 0 knockout matches — keeping existing data, no rewrite.");
  writeDeployNeededOutput(false);
  process.exit(0);
}

const state = { version, round, generatedAt, anyLive, champion, eliminated: elimSweep, bracket };

let published = null;
if (publishedPath) {
  try { published = JSON.parse(fs.readFileSync(publishedPath, "utf8")); } catch (e) {}
}
if (published && resultsFingerprintExcludingTimestamp(published) === resultsFingerprintExcludingTimestamp(state)) {
  console.log("NO_CHANGE: results identical to the published site — skipping deploy.");
  writeDeployNeededOutput(false);
  process.exit(0);
}
writeDeployNeededOutput(true);

// --- write data.json (polled live by the page) ---
fs.writeFileSync(path.join(path.dirname(htmlPath), "data.json"), JSON.stringify(state));

// --- bake the same into the HTML (static fallback) ---
const j = v => JSON.stringify(v);
const bracketLines = bracket.map(r => `  { name:${j(r.name)}, matches:${j(r.matches)} }`).join(",\n");
const block =
`/* === RESULTS:START — auto-generated from football-data.org; do not hand-edit === */
let DATA_VERSION = ${j(version)};
let ROUND = ${j(round)};
let GENERATED_AT = ${j(generatedAt)};
let ANY_LIVE = ${j(anyLive)};
let CHAMPION = ${j(champion)};
let ELIMINATED = ${j(elimSweep)};
let BRACKET = [
${bracketLines}
];
/* === RESULTS:END === */`;

let html = fs.readFileSync(htmlPath, "utf8");
const re = /\/\* === RESULTS:START[\s\S]*?=== RESULTS:END === \*\//;
if (!re.test(html)) { console.error("RESULTS markers not found in HTML"); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(re, block));

console.log("ROUND:", round, "| anyLive:", anyLive, "| champion:", champion);
console.log("ELIMINATED:", elimSweep.length, elimSweep.join(", ") || "(none)");
bracket.forEach(r => {
  const live = r.matches.filter(x => x.st === "LIVE" || x.st === "HT").length;
  const ft = r.matches.filter(x => x.st === "FT").length;
  console.log(`  ${r.name}: ${r.matches.length} matches · ${ft} FT · ${live} live`);
});
