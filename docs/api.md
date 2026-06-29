# Botliga public API and CLI

The public API lets you drive Botliga headless: list games, submit bots, run matches, and
read replays. It is meant for developers and for coding agents (Claude Code, Codex) that
build and iterate on bots without the web UI.

Base URL is `https://botliga.com`. Self-hosted instances use their own origin. Most paths
live under `/api/v1` and speak JSON. The starter-zip download is the one exception and sits
at `/api/starter-zip`.

## Authentication

Authenticated endpoints need a personal API key.

1. Sign in at `https://botliga.com` and open your profile.
2. Under API keys, create a key and give it a name.
3. Copy the key. It is shown once. It looks like `bl_` followed by a random token, for
   example `bl_Yh3...`.

Send it as a Bearer token:

```sh
curl -H "Authorization: Bearer bl_yourkey" https://botliga.com/api/v1/me
```

Public endpoints (`games`, `arena`, `leaderboard`, `starter-zip`) do not require a key. If
you send one anyway it is ignored, so a single client can call both kinds the same way.

The server stores only a SHA-256 hash of the key, never the key itself. If you lose a key,
revoke it from your profile and create a new one.

## Endpoints

`<base>` is `https://botliga.com` (or your instance). Auth means the call needs the Bearer
header.

### `GET /api/v1/me` (auth)

Who the key belongs to.

```sh
curl -H "Authorization: Bearer bl_yourkey" <base>/api/v1/me
```

```json
{ "handle": "ada", "email": "ada@example.com" }
```

### `GET /api/v1/games` (public)

All games and their variants.

```sh
curl <base>/api/v1/games
```

```json
[
  {
    "slug": "tron",
    "name": "Tron",
    "variants": [
      { "slug": "1v1", "name": "1v1", "players": 2, "is_default": true }
    ]
  }
]
```

### `GET /api/v1/games/<slug>/arena?variant=<v>` (public)

The roster you can challenge for a game. `variant` is optional and defaults to the game's
default variant.

```sh
curl "<base>/api/v1/games/tron/arena?variant=1v1"
```

```json
[
  { "bot_id": "9f...", "name": "Wallhugger", "handle": "ada", "house": false, "version": 3, "display_rating": 1240 }
]
```

`house` bots are built-in opponents. Their `name` is what you pass to `play` as
`house:<Name>`.

### `GET /api/v1/games/<slug>/leaderboard?variant=<v>` (public)

Ranked players for a game.

```sh
curl "<base>/api/v1/games/tron/leaderboard?variant=1v1"
```

```json
[
  { "handle": "ada", "display_rating": 1240, "played": 57 }
]
```

### `GET /api/v1/games/<slug>/ranking?variant=<v>` (public)

The official ordinal ladder for a game and variant, best first. `variant` is optional and
defaults to the game's default variant. This is the ranking set by the weekly cup, not the
Elo leaderboard above. See [ranking.md](./ranking.md) for how it is built.

```sh
curl "<base>/api/v1/games/tron/ranking?variant=1v1"
```

```json
[
  { "rank": 1, "bot_id": "9f...", "name": "Wallhugger", "handle": "ada", "house": false, "provisional": false }
]
```

`house` bots are built-in opponents and have no `handle`. A `provisional` row is a mid-week
insertion that the next cup will re-rank.

### `GET /api/v1/bots` (auth)

Your bots.

```sh
curl -H "Authorization: Bearer bl_yourkey" <base>/api/v1/bots
```

```json
[
  {
    "id": "b1...",
    "name": "Wallhugger",
    "game": "tron",
    "published": true,
    "latest_status": "active",
    "latest_reject": null,
    "active_version": "v3..."
  }
]
```

### `POST /api/v1/bots` (auth)

Create a new bot version. Two modes:

- Compiled: send `wasm` as base64 of a `.wasm` file.
- Source: send `language` plus `source` and the server compiles it.

Pass `botId` to add a version to an existing bot, or omit it (with an optional `name`) to
create a new bot. Languages: `rust`, `c`, `cpp`, `go`, `swift`, `assemblyscript`.

Optional flags on the bot (all default to `false`):

- `published`: list the bot publicly and let others challenge it.
- `openSource`: allow others to download the bot, both the compiled `.wasm` and the source
  you submitted (see the download endpoints below). Requires `published`.
- `useForRankings`: make this the one ranked bot for the game, so it enters the weekly cup.
  See [ranking.md](./ranking.md).

```sh
curl -X POST -H "Authorization: Bearer bl_yourkey" -H "Content-Type: application/json" \
  -d '{"game":"tron","name":"Wallhugger","language":"rust","source":"...","published":true,"openSource":true,"useForRankings":true}' \
  <base>/api/v1/bots
```

```json
{ "botVersionId": "v4..." }
```

On failure the body is `{ "error": "..." }` with a non-2xx status.

### `GET /api/v1/bots/<id>` (auth)

A bot version's compile and validation status. `<id>` is a bot version id.

```sh
curl -H "Authorization: Bearer bl_yourkey" <base>/api/v1/bots/v4...
```

```json
{
  "bot_version_id": "v4...",
  "bot_id": "b1...",
  "name": "Wallhugger",
  "game": "tron",
  "status": "active",
  "reject_reason": null,
  "active": true
}
```

`status` is `pending`, `active`, or `rejected`. A rejected version carries a
`reject_reason`.

### `GET /api/v1/bots/<id>/download` (public)

The compiled `.wasm` artifact for a bot, served only when the bot is `published` and
`openSource`. `<id>` is a bot id. Other bots return `404`. The body is the raw `.wasm` bytes,
not JSON.

```sh
curl -o bot.wasm "<base>/api/v1/bots/b1.../download"
```

### `GET /api/v1/bots/<id>/source` (public)

The source the author submitted, in whatever language it was written. Same access rule as the
download endpoint (`published` and `openSource`). The body is the raw source text, with the
right file extension in the `Content-Disposition`. A version uploaded as a raw `.wasm` has no
source and returns `404`.

```sh
curl -OJ "<base>/api/v1/bots/b1.../source"
```

### `POST /api/v1/matches` (auth)

Run a match. Each token in `bots` is a bot version id, the literal `random` (a random
eligible bot), or `house:<Name>` (a built-in opponent). The count must match the variant's
player count.

```sh
curl -X POST -H "Authorization: Bearer bl_yourkey" -H "Content-Type: application/json" \
  -d '{"game":"tron","variant":"1v1","bots":["v4...","random"]}' \
  <base>/api/v1/matches
```

```json
{ "matchId": "m7..." }
```

### `GET /api/v1/matches/<id>` (auth)

Match status and result.

```sh
curl -H "Authorization: Bearer bl_yourkey" <base>/api/v1/matches/m7...
```

```json
{
  "id": "m7...",
  "status": "finished",
  "game": "tron",
  "variant": "1v1",
  "finished_at": "2026-06-26T10:00:00Z",
  "players": [
    { "bot_id": "v4...", "name": "Wallhugger", "handle": "ada", "placement": 1 }
  ],
  "replayAvailable": true,
  "failureReason": null
}
```

### `GET /api/v1/matches/<id>/replay` (auth)

The replay as JSON. The shape is the per-game replay format used by the web player.

```sh
curl -H "Authorization: Bearer bl_yourkey" <base>/api/v1/matches/m7.../replay
```

### `GET /api/starter-zip?game=<slug>&lang=<lang>` (public)

A starter project for a game in a language, as a zip. Languages: `rust`, `c`, `cpp`, `go`,
`swift`, `assemblyscript`. The zip holds the runtime, a `bot` source file to edit, a build
script, and a README.

```sh
curl -o tron-rust.zip "<base>/api/starter-zip?game=tron&lang=rust"
```

## CLI

`cli/botliga.mjs` is a single-file Node client over this API. No npm dependencies; it needs
Node 18 or newer (it uses the built-in `fetch`).

### Install

Run it directly:

```sh
node cli/botliga.mjs --help
```

Or link it onto your `PATH` so `botliga` works anywhere:

```sh
cd cli && npm link    # or: chmod +x botliga.mjs && ln -s "$PWD/botliga.mjs" /usr/local/bin/botliga
```

### Config

The CLI resolves the base URL and key in this order:

- Base URL: `BOTLIGA_API_URL`, else the `url` in `~/.botliga`, else `https://botliga.com`.
- Key: `BOTLIGA_API_KEY`, else the `key` in `~/.botliga`.

`~/.botliga` is JSON, mode `0600`:

```json
{ "key": "bl_yourkey", "url": "https://botliga.com" }
```

`url` is optional. Use `botliga login` to write this file instead of editing it by hand.

### Commands

```
login [<key>]                              store an API key in ~/.botliga (0600); reads stdin if omitted
me                                         show the authenticated handle and email
games                                      list games and their variants
leaderboard --game <slug> [--variant <v>]  print the leaderboard
arena --game <slug> [--variant <v>]        print the challengeable roster
ranking <game> [variant]                   print the official ranking ladder
starter --game <slug> --lang <lang> [--out <path>]
                                           download a starter project zip
bots                                       list my bots
submit --game <slug> [--name <n>] [--bot <botId>] (--wasm <file> | --file <src> [--lang <lang>])
                                           upload a compiled .wasm, or source to compile
bot <botVersionId>                         show a bot version's status
download <botId> [outfile] [--source]      save a published open-source bot's .wasm (or its source)
wait <botVersionId> [--timeout <secs>]     poll until active or rejected (default 300s)
play --game <slug> [--variant <v>] --bots <a,b,...>
                                           create a match; tokens are version ids, random, or house:Name
match <id>                                 show match status and placements
replay <id> [--out <file>]                 fetch the replay JSON (stdout or --out)
```

Notes:

- `login` never prints the key back; it prints where it saved the file. Pipe a key in to
  keep it out of shell history: `echo bl_yourkey | botliga login`.
- `submit --file` infers the language from the extension when `--lang` is absent:
  `.rs`=rust, `.c`=c, `.cpp`/`.cc`=cpp, `.go`=go, `.swift`=swift, `.ts`=assemblyscript.
- `wait` exits non-zero on a rejected bot or a timeout, so scripts can branch on it.
- On an HTTP error the CLI prints the server's `error` field to stderr and exits non-zero.

### End-to-end example (for an AI agent)

```sh
# 1. Authenticate (create a key in your Botliga profile first).
echo bl_yourkey | node cli/botliga.mjs login

# 2. Grab a starter project and unpack it.
node cli/botliga.mjs starter --game tron --lang rust
unzip tron-rust.zip

# 3. Edit the strategy in tron-rust/bot.rs (the `act` function).

# 4. Submit the source to compile. Capture the returned version id.
ID=$(node cli/botliga.mjs submit --game tron --file tron-rust/bot.rs | sed 's/.*: //')

# 5. Wait for the compile and validation to finish.
node cli/botliga.mjs wait "$ID"

# 6. Play it against a random opponent and capture the match id.
MATCH=$(node cli/botliga.mjs play --game tron --bots "$ID",random | sed -n 's/^matchId: //p')

# 7. Read the result.
node cli/botliga.mjs match "$MATCH"
```
