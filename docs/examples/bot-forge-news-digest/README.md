# News Digest

> Summarizes web articles the user links into short Thai briefs.

**Access:** Works through its connectors only, no files

## What it can do

- Opens web pages the user links
- Writes five-bullet summaries in plain Thai
- Fetch: Open web pages and read their content.
- Skill thai-brief: Five bullets in plain Thai, with the source

## Try asking

- “สรุปข่าวนี้ให้หน่อย https://example.com/news”

## Connectors

- **Fetch** (`fetch`) — `npx -y @modelcontextprotocol/server-puppeteer@2025.5.12`

## Skills

- **thai-brief** — Five bullets in plain Thai, with the source

## Install

- **Mali Cowork:** Settings › Team › Import bot, and pick the .zip (or this folder). Choose whether it joins the team, is your own bot in the chat box, or both — and which model it runs on.
- **Claude Code:** add this folder as a plugin (e.g. from a local marketplace).
- Set the variables listed under Connectors where the bot runs; they are never stored in these files.

_Made with bot-forge._
