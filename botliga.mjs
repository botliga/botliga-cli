#!/usr/bin/env node
// Botliga CLI: a thin client over the public API for developers and coding agents.
// Single file, zero npm dependencies, so it can be vendored or curl'd anywhere Node 18+ runs.

import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, extname } from "node:path";
import process from "node:process";

const DEFAULT_URL = "https://botliga.com";
const CONFIG_PATH = join(homedir(), ".botliga");

// ---------------------------------------------------------------------------
// Config: env wins over the on-disk credentials file so CI can override without
// touching the user's home directory.
// ---------------------------------------------------------------------------

function readConfigFile() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // Missing or unreadable file is a normal "not logged in" state, not an error.
    return {};
  }
}

function loadConfig() {
  const file = readConfigFile();
  const url = (process.env.BOTLIGA_API_URL || file.url || DEFAULT_URL).replace(/\/+$/, "");
  const key = process.env.BOTLIGA_API_KEY || file.key || null;
  return { url, key };
}

// ---------------------------------------------------------------------------
// Tiny arg parser: collects positionals and --flag value / --flag=value pairs.
// Bare flags (next token starts with -- or is absent) become boolean true.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          flags[name] = true;
        } else {
          flags[name] = next;
          i++;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

// ---------------------------------------------------------------------------
// HTTP. We always attach the key when present; public endpoints ignore it but
// authed ones need it, and sending it everywhere keeps the call sites simple.
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function api(method, path, { body, raw } = {}) {
  const { url, key } = loadConfig();
  const headers = {};
  if (key) headers["Authorization"] = `Bearer ${key}`;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${url}${path}`, { method, headers, body: payload });
  } catch (e) {
    // Network-level failures never reach the JSON branch below, so surface them here.
    fail(`request failed: ${String(e)}`);
  }

  if (!res.ok) {
    // The API reports its own reasons in an `error` field; fall back to the status line.
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && data.error) detail = data.error;
    } catch {
      // Non-JSON error body (e.g. an HTML 502); the status text is the best we have.
    }
    fail(`error: ${detail} (HTTP ${res.status})`);
  }

  if (raw) return res;
  return res.json();
}

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Source language inference, kept next to `submit` since that is its only caller.
// ---------------------------------------------------------------------------

const EXT_LANG = {
  ".rs": "rust",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".go": "go",
  ".swift": "swift",
  ".ts": "assemblyscript",
};

function inferLang(file) {
  return EXT_LANG[extname(file).toLowerCase()] || null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdLogin(positionals) {
  let key = positionals[0];
  if (!key) {
    // No key on the command line means read one line from stdin, so the key never
    // lands in shell history.
    key = (await readStdin()).split("\n")[0].trim();
  }
  if (!key) fail("no key provided");

  const config = { key: key.trim() };
  // Persist the URL only when explicitly overridden, so the file stays portable.
  if (process.env.BOTLIGA_API_URL) config.url = process.env.BOTLIGA_API_URL.replace(/\/+$/, "");

  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
  process.stdout.write(`saved credentials to ${CONFIG_PATH}\n`);
}

async function cmdMe() {
  const me = await api("GET", "/api/v1/me");
  process.stdout.write(`handle: ${me.handle}\nemail:  ${me.email}\n`);
}

async function cmdGames() {
  const games = await api("GET", "/api/v1/games");
  for (const g of games) {
    process.stdout.write(`${g.slug}  ${g.name}\n`);
    for (const v of g.variants || []) {
      const mark = v.is_default ? " (default)" : "";
      process.stdout.write(`    ${v.slug}  ${v.name}  players=${v.players}${mark}\n`);
    }
  }
}

function variantQuery(flags) {
  return flags.variant ? `?variant=${encodeURIComponent(flags.variant)}` : "";
}

async function cmdLeaderboard(flags) {
  if (!flags.game) fail("leaderboard requires --game <slug>");
  const rows = await api("GET", `/api/v1/games/${encodeURIComponent(flags.game)}/leaderboard${variantQuery(flags)}`);
  for (const r of rows) {
    process.stdout.write(`${String(r.display_rating).padStart(6)}  ${r.handle}  (played=${r.played})\n`);
  }
}

async function cmdArena(flags) {
  if (!flags.game) fail("arena requires --game <slug>");
  const rows = await api("GET", `/api/v1/games/${encodeURIComponent(flags.game)}/arena${variantQuery(flags)}`);
  for (const r of rows) {
    const who = r.house ? `house:${r.name}` : `${r.name} (@${r.handle})`;
    process.stdout.write(`${r.bot_id}  ${who}  v${r.version}  rating=${r.display_rating}\n`);
  }
}

async function cmdRanking(positionals) {
  const game = positionals[0];
  if (!game) fail("ranking requires <game> [variant]");
  const variant = positionals[1];
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  const rows = await api("GET", `/api/v1/games/${encodeURIComponent(game)}/ranking${q}`);
  for (const r of rows) {
    const who = r.house ? `house:${r.name}` : `${r.name} (@${r.handle})`;
    const flag = r.provisional ? "  (provisional)" : "";
    process.stdout.write(`${String(r.rank).padStart(4)}  ${who}${flag}\n`);
  }
}

// A bot reference from the tournament view: house bots carry the handle "house".
function botRef(b) {
  if (!b) return "TBD";
  return b.handle === "house" ? `house:${b.name}` : `${b.name} (@${b.handle})`;
}

async function cmdTournaments(positionals) {
  const slug = positionals[0];
  if (!slug) {
    const rows = await api("GET", "/api/v1/tournaments");
    for (const t of rows) {
      const when = t.starts_at || "-";
      process.stdout.write(`${t.status.padEnd(10)}  ${t.game} / ${t.variant}  ${t.slug}  ${when}\n`);
    }
    return;
  }

  const t = await api("GET", `/api/v1/tournaments/${encodeURIComponent(slug)}`);
  const info = t.tournament;
  process.stdout.write(`${info.name}\n`);
  process.stdout.write(`slug:    ${info.slug}\n`);
  process.stdout.write(`status:  ${info.status}\n`);
  process.stdout.write(`game:    ${info.game} / ${info.variant}\n`);
  if (info.starts_at) process.stdout.write(`starts:  ${info.starts_at}\n`);
  if (info.winner_handle) process.stdout.write(`winner:  @${info.winner_handle}\n`);

  const entrants = t.entrants || [];
  if (entrants.length) {
    process.stdout.write(`\nParticipants (${entrants.length}):\n`);
    for (const e of entrants) {
      const seed = e.seed != null ? String(e.seed).padStart(3) : "  -";
      process.stdout.write(`  ${seed}  ${botRef(e)}\n`);
    }
  }

  for (const g of t.groups || []) {
    process.stdout.write(`\nGroup ${g.group_no + 1}:\n`);
    for (const s of g.standings) {
      process.stdout.write(`  ${String(s.rank).padStart(3)}  ${botRef(s)}  ${s.points} pts\n`);
    }
  }

  for (const r of (t.bracket && t.bracket.rounds) || []) {
    process.stdout.write(`\n${r.name}:\n`);
    for (const tie of r.ties) {
      const a = botRef(tie.sideA);
      const b = botRef(tie.sideB);
      // winner_bot_id tells us which side won; fall back to the live status otherwise.
      const winner = tie.winner_bot_id
        ? tie.winner_bot_id === (tie.sideA && tie.sideA.bot_id) ? a : b
        : null;
      const tail = winner ? `  winner: ${winner}` : `  (${tie.status})`;
      process.stdout.write(`  ${tie.label}: ${a} vs ${b}${tail}\n`);
      for (const leg of tie.legs || []) {
        process.stdout.write(`      leg ${leg.leg}: ${leg.winner ? `won by ${leg.winner}` : leg.status}\n`);
      }
    }
  }

  const ranking = t.ranking || [];
  if (ranking.length) {
    process.stdout.write(`\nFinal ranking:\n`);
    for (const r of ranking) {
      process.stdout.write(`  ${String(r.rank).padStart(3)}  ${botRef(r)}\n`);
    }
  }
}

async function cmdStarter(flags) {
  if (!flags.game || !flags.lang) fail("starter requires --game <slug> and --lang <lang>");
  const out = flags.out || `${flags.game}-${flags.lang}.zip`;
  // The zip endpoint lives outside /api/v1 and returns bytes, so handle it raw.
  const res = await api("GET", `/api/starter-zip?game=${encodeURIComponent(flags.game)}&lang=${encodeURIComponent(flags.lang)}`, { raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(out, buf);
  process.stdout.write(`saved ${out} (${buf.length} bytes)\n`);
  process.stdout.write(`unzip it, edit the bot source, then: botliga submit --game ${flags.game} --file <bot-source>\n`);
}

async function cmdBots() {
  const bots = await api("GET", "/api/v1/bots");
  for (const b of bots) {
    const pub = b.published ? "published" : "private";
    const status = b.latest_status || "?";
    let line = `${b.id}  ${b.name}  [${b.game}]  ${pub}  status=${status}`;
    if (b.active_version) line += `  active=${b.active_version}`;
    if (b.latest_reject) line += `  reject=${b.latest_reject}`;
    process.stdout.write(`${line}\n`);
  }
}

async function cmdSubmit(flags) {
  if (!flags.game) fail("submit requires --game <slug>");
  if (!flags.wasm && !flags.file) fail("submit requires --wasm <file> or --file <source>");

  const body = { game: flags.game };
  if (flags.name) body.name = flags.name;
  if (flags.bot) body.botId = flags.bot;

  if (flags.wasm) {
    // Compiled artifact path: ship the bytes base64-encoded, no server-side compile.
    body.wasm = readFileSync(flags.wasm).toString("base64");
  } else {
    const lang = flags.lang || inferLang(flags.file);
    if (!lang) fail(`could not infer language from ${flags.file}; pass --lang <lang>`);
    body.language = lang;
    body.source = readFileSync(flags.file, "utf8");
  }

  const res = await api("POST", "/api/v1/bots", { body });
  process.stdout.write(`botVersionId: ${res.botVersionId}\n`);
}

async function fetchBot(id) {
  return api("GET", `/api/v1/bots/${encodeURIComponent(id)}`);
}

async function cmdBot(positionals) {
  const id = positionals[0];
  if (!id) fail("bot requires <botVersionId>");
  const b = await fetchBot(id);
  process.stdout.write(`status: ${b.status}\n`);
  if (b.reject_reason) process.stdout.write(`reject_reason: ${b.reject_reason}\n`);
}

async function cmdDownload(positionals, flags) {
  const id = positionals[0];
  if (!id) fail("download requires <botId> [outfile]");
  // Both endpoints serve raw bytes, available only for published open-source bots.
  const endpoint = flags.source ? "source" : "download";
  const res = await api("GET", `/api/v1/bots/${encodeURIComponent(id)}/${endpoint}`, { raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  let out = positionals[1];
  if (!out) {
    if (flags.source) {
      // The server names the source file with the right extension; honor it.
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      out = m ? m[1] : `${id}.txt`;
    } else {
      out = `${id}.wasm`;
    }
  }
  writeFileSync(out, buf);
  process.stdout.write(`saved ${out} (${buf.length} bytes)\n`);
}

async function cmdWait(positionals, flags) {
  const id = positionals[0];
  if (!id) fail("wait requires <botVersionId>");
  const timeoutSecs = flags.timeout ? Number(flags.timeout) : 300;
  const deadline = Date.now() + timeoutSecs * 1000;

  for (;;) {
    const b = await fetchBot(id);
    if (b.status === "active") {
      process.stdout.write(`status: active\n`);
      return;
    }
    if (b.status === "rejected") {
      process.stdout.write(`status: rejected\n`);
      if (b.reject_reason) process.stdout.write(`reject_reason: ${b.reject_reason}\n`);
      process.exit(1);
    }
    if (Date.now() >= deadline) {
      // A non-zero exit lets a calling script branch on "still not active".
      fail(`timed out after ${timeoutSecs}s; last status: ${b.status}`);
    }
    // ~2s between polls keeps the compile queue lightly loaded.
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function cmdPlay(flags) {
  if (!flags.game) fail("play requires --game <slug>");
  if (!flags.bots) fail("play requires --bots <a,b,...>");
  const bots = String(flags.bots)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body = { game: flags.game, bots };
  if (flags.variant) body.variant = flags.variant;

  const res = await api("POST", "/api/v1/matches", { body });
  const { url } = loadConfig();
  process.stdout.write(`matchId: ${res.matchId}\n`);
  process.stdout.write(`${url}/matches/${res.matchId}\n`);
}

async function cmdMatch(positionals) {
  const id = positionals[0];
  if (!id) fail("match requires <id>");
  const m = await api("GET", `/api/v1/matches/${encodeURIComponent(id)}`);
  process.stdout.write(`match ${m.id}  [${m.game}${m.variant ? `/${m.variant}` : ""}]  status=${m.status}\n`);
  if (m.finished_at) process.stdout.write(`finished_at: ${m.finished_at}\n`);
  for (const p of m.players || []) {
    const place = p.placement !== undefined && p.placement !== null ? `#${p.placement}` : "-";
    const who = p.name || p.handle || p.bot_id || "?";
    process.stdout.write(`  ${place}  ${who}\n`);
  }
  if (m.failureReason) process.stdout.write(`failureReason: ${m.failureReason}\n`);
  process.stdout.write(`replayAvailable: ${m.replayAvailable ? "yes" : "no"}\n`);
}

async function cmdReplay(positionals, flags) {
  const id = positionals[0];
  if (!id) fail("replay requires <id>");
  const replay = await api("GET", `/api/v1/matches/${encodeURIComponent(id)}/replay`);
  if (flags.out) {
    writeFileSync(flags.out, `${JSON.stringify(replay)}\n`);
    process.stdout.write(`saved ${flags.out}\n`);
  } else {
    print(replay);
  }
}

const USAGE = `botliga - CLI for the Botliga public API

Usage: botliga <command> [options]

Config:
  BOTLIGA_API_URL   base URL (default https://botliga.com)
  BOTLIGA_API_KEY   API key; otherwise read from ~/.botliga
  ~/.botliga        JSON { "key": "bl_...", "url": "..." } (url optional)

Commands:
  login [<key>]                              store an API key in ~/.botliga (0600); reads stdin if omitted
  me                                         show the authenticated handle and email
  games                                      list games and their variants
  leaderboard --game <slug> [--variant <v>]  print the leaderboard
  arena --game <slug> [--variant <v>]        print the challengeable roster
  ranking <game> [variant]                   print the official ranking ladder
  tournaments [<slug>]                        list World Cups, or show one's groups and bracket
  starter --game <slug> --lang <lang> [--out <path>]
                                             download a starter project zip (rust|c|cpp|go|swift|assemblyscript)
  bots                                       list my bots
  submit --game <slug> [--name <n>] [--bot <botId>] (--wasm <file> | --file <src> [--lang <lang>])
                                             upload a compiled .wasm, or source to compile
  bot <botVersionId>                         show a bot version's status
  download <botId> [outfile] [--source]      save a published open-source bot's .wasm (or its source with --source)
  wait <botVersionId> [--timeout <secs>]     poll until active or rejected (default 300s)
  play --game <slug> [--variant <v>] --bots <a,b,...>
                                             create a match; tokens are version ids, random, or house:Name
  match <id>                                 show match status and placements
  replay <id> [--out <file>]                 fetch the replay JSON (stdout or --out)

Example flow:
  botliga login bl_xxxxxxxx
  botliga starter --game tron --lang rust
  # ...edit tron-rust/bot.rs...
  ID=$(botliga submit --game tron --file tron-rust/bot.rs | sed 's/.*: //')
  botliga wait "$ID"
  botliga play --game tron --bots "$ID",random
  botliga match <matchId>
`;

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const { positionals, flags } = parseArgs(argv.slice(1));

  switch (command) {
    case "login":
      return cmdLogin(positionals);
    case "me":
      return cmdMe();
    case "games":
      return cmdGames();
    case "leaderboard":
      return cmdLeaderboard(flags);
    case "arena":
      return cmdArena(flags);
    case "ranking":
      return cmdRanking(positionals);
    case "tournaments":
      return cmdTournaments(positionals);
    case "starter":
      return cmdStarter(flags);
    case "bots":
      return cmdBots();
    case "submit":
      return cmdSubmit(flags);
    case "bot":
      return cmdBot(positionals);
    case "download":
      return cmdDownload(positionals, flags);
    case "wait":
      return cmdWait(positionals, flags);
    case "play":
      return cmdPlay(flags);
    case "match":
      return cmdMatch(positionals);
    case "replay":
      return cmdReplay(positionals, flags);
    default:
      fail(`unknown command: ${command}\nrun "botliga --help" for usage`);
  }
}

main();
