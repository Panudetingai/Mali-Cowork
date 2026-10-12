# bot-forge

Describe a bot, get a bot. bot-forge writes a single-duty agent from a sentence —
its duty, instructions, capabilities and any skills it needs — picks connectors
(MCP servers) for it, and packs it as a **plugin folder** that Mali Cowork and
Claude Code install as they are. It runs on its own: Mali doesn't need to be open.

```bash
cd bot-forge && bun install
export ANTHROPIC_API_KEY=...              # or: ant auth login
bun src/cli.ts new "a bot that reviews my GitHub pull requests"
bun src/cli.ts serve                     # the web page, http://127.0.0.1:4317
```

`bun run build` makes `dist/cli.js`, which runs on Node 20+ (`node dist/cli.js …`).

## Commands

| | |
|---|---|
| `new "<description>"` | generate a bot (`--provider`, `--model`, `--base-url`) |
| `providers`, `models`, `use <provider>` | pick the model that designs bots (see below) |
| `list`, `show <bot>` | your bots; what one can do and what it's connected to (`--json`) |
| `edit <bot>` | `--name`, `--duty`, `--tools none\|read\|files\|all`, `--instructions-file` |
| `catalog [search]` | connectors bot-forge knows (Mali's vetted catalog) |
| `add-mcp <bot> <id>` | a catalog connector; or `--url <mcp url> [--header K=V]` / `--command "<cmd>"`, with `--env VAR` |
| `remove-mcp`, `add-skill <bot> <SKILL.md or folder>`, `remove-skill` | |
| `check <bot>` | connect to each connector (MCP handshake + `tools/list`); shows what it runs and asks first |
| `export <bot>` | a `.zip` (`--out`), or a folder (`--folder`) |
| `import <path>` | a `.zip`, a plugin folder, a `bot.json`, or a Mali Bot Studio export |
| `serve` | the web page (`--port`) |

Bots live in `./bots`, or `$BOT_FORGE_HOME`.

## Generator: any provider

Pick what your group can afford — from the web page (click the model chip at
the top) or the terminal:

```bash
bot-forge providers                       # what's available, which keys are set
bot-forge use ollama --model qwen3:4b     # free, on this computer
bot-forge use groq --model <model>        # needs GROQ_API_KEY
bot-forge use custom --base-url http://gpu-box:8000/v1 --model <model>
bot-forge models                          # what the chosen provider offers
```

| Provider | Key | |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` or `ant auth login` | default `claude-opus-5-5`; `claude-haiku-5-5` costs about 1/40 of it |
| OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Mistral, Together | `<NAME>_API_KEY` | OpenAI-compatible APIs |
| Ollama, LM Studio | none | runs on this computer, free |
| Other | `BOT_FORGE_API_KEY` (optional) | any `/chat/completions` server: vLLM, LiteLLM, a company gateway |

`--provider`, `--model`, `--base-url` on `new` override the choice for one bot.
A key typed into the web page is kept only while `serve` runs; keys are never
written to disk.

Small and local models are helped along: their JSON is read forgivingly
(prose, code fences and `<think>` sections around it, missing fields filled
in), a server without JSON mode is asked again without it, and an answer that
isn't a bot design gets one chance to be fixed. Expect simpler instructions
from a 4B model than from Claude — edit them on the page before exporting.

The generator only picks connectors from the catalog; a service it doesn't
know (Gmail, Notion…) is named in a note for you to add with `add-mcp --url`.

## The bot on disk

```text
<slug>/
├── .claude-plugin/plugin.json   name, version, description
├── agents/<slug>.md             duty, tools, instructions; mali-connectors / mali-skills say what it owns
├── skills/<name>/SKILL.md       its skills
├── .mcp.json                    its connectors — ${VARIABLES}, never values
├── bot.json                     the full spec (bot-forge reads this)
└── README.md                    what it does, what it needs, how to install it
```

- **Mali Cowork:** Settings › Team › **Import bot**, then pick the `.zip` (or
  the folder). Choose where it goes — **your own bot** (pick it in the chat
  box's model menu and talk to it directly), **on the team** (the lead hands it
  jobs), or both — and **which model it runs on**: any model set up in Mali,
  from any provider. It owns its connectors and skills (duties never overlap).
- **Claude Code:** add the folder as a plugin.

An example: [`docs/examples/bot-forge-news-digest`](../docs/examples/bot-forge-news-digest).

## Safety

- No secrets in bot files: connectors name variables; values come from the
  environment. Values found written into an imported `.mcp.json` are dropped.
- Importing never runs anything. `check` shows each command or URL and asks
  before it starts one — an imported bot's commands are someone else's.
- The web page listens on 127.0.0.1 only, answers only its own host name, and
  every API call needs the token of that run.

## Development

```bash
bun test            # tests
bun run typecheck
bun run sync-catalog   # after Mali's src/features/mcp/catalog.ts changes
```
