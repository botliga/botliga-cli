<p align="center">
  <a href="https://botliga.com">
    <img src="assets/logo.svg" alt="Botliga" width="88" height="88" />
  </a>
</p>

<h1 align="center">botliga-cli</h1>

A thin client over the [Botliga](https://botliga.com) public API, for developers and coding
agents. One file, zero npm dependencies, runs anywhere Node 18+ is installed.

## Install

Grab the single file and make it executable:

```sh
curl -fsSL https://botliga.com/botliga.mjs -o botliga
chmod +x botliga
./botliga --help
```

Or clone this repo and run `./botliga.mjs` directly. There is nothing to build and nothing to
install.

## Configuration

The CLI reads its API key and base URL from the environment first, then from `~/.botliga`:

| Source            | Key                | Notes                                            |
| ----------------- | ------------------ | ------------------------------------------------ |
| env               | `BOTLIGA_API_KEY`  | API key (`bl_...`)                               |
| env               | `BOTLIGA_API_URL`  | base URL, default `https://botliga.com`          |
| `~/.botliga`      | `{ "key", "url" }` | JSON; `url` optional; written `0600` by `login`  |

Env wins over the file, so CI can override without touching the home directory. Get an API key
from your account on `https://botliga.com`, then:

```sh
botliga login bl_xxxxxxxx   # or: echo "$KEY" | botliga login
botliga me
```

## Commands

```
login [<key>]                              store an API key in ~/.botliga (0600); reads stdin if omitted
me                                         show the authenticated handle and email
games                                      list games and their variants
leaderboard --game <slug> [--variant <v>]  print the leaderboard
arena --game <slug> [--variant <v>]        print the challengeable roster
ranking <game> [variant]                   print the official ranking ladder
tournaments [<slug>]                       list World Cups, or show one's groups and bracket
starter --game <slug> --lang <lang> [--out <path>]
                                           download a starter project zip (rust|c|cpp|go|swift|assemblyscript)
bots                                       list my bots
submit --game <slug> [--name <n>] [--bot <botId>] (--wasm <file> | --file <src> [--lang <lang>])
                                           upload a compiled .wasm, or source to compile
bot <botVersionId>                         show a bot version's status
download <botId> [outfile]                 save a published open-source bot's .wasm
wait <botVersionId> [--timeout <secs>]     poll until active or rejected (default 300s)
play --game <slug> [--variant <v>] --bots <a,b,...>
                                           create a match; tokens are version ids, random, or house:Name
match <id>                                 show match status and placements
replay <id> [--out <file>]                 fetch the replay JSON (stdout or --out)
```

## Example flow

```sh
botliga login bl_xxxxxxxx
botliga starter --game tron --lang rust
# ...edit tron-rust/bot.rs...
ID=$(botliga submit --game tron --file tron-rust/bot.rs | sed 's/.*: //')
botliga wait "$ID"
botliga play --game tron --bots "$ID",random
botliga match <matchId>
```

## API

The CLI is a thin wrapper over the `/api/v1` HTTP endpoints, documented in
[`docs/api.md`](./docs/api.md), so you can script against the API directly if you prefer.

## License

[MIT](./LICENSE)
