# Bookish MCP server

Ask an AI assistant about a fantasy series **without it spoiling the books for you.**

```bash
npm run mcp        # stdio, for a local MCP client
```

## Claude Desktop

```json
{
  "mcpServers": {
    "bookish": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/Bookish/mcp/server.ts"]
    }
  }
}
```

Then: *"I'm on book 2 of The Empyrean. Who is Xaden bonded to?"*

---

## The guardrail is in the data layer

Every tool reads through `gate()` in [`src/spoiler.ts`](../src/spoiler.ts) — **the same function the website's ask box and the chart renderer use.** A model talking to this server cannot be argued past the reading position, because data beyond it is never placed in the response. There is no instruction to ignore.

That is the whole design claim, and it is the one worth testing.

### Reading position is server state

It lives on the server rather than being a parameter on every call, so a client cannot forget to pass it and receive the whole series by accident.

**It defaults to book 1 — the most conservative position — not the last.** A reader who never sets a position gets the least, not the most.

### Refusals do not confirm

Asking about a character from a later book returns:

```
No such character in The Empyrean at your reading position.
```

Not *"that character appears in book 3"*, which would leak their existence. The response also **does not echo the query**, so nothing in it can be read as confirmation.

---

## Tools

| Tool | What it does |
|---|---|
| `list_series` | The three series and where you are in each |
| `set_reading_position` | How far you have read. Everything else is bounded by this. |
| `search_characters` | Find by name or role — only people you have met |
| `get_character` | Details as **you currently understand them** |
| `get_relationships` | Their relationships, optionally filtered by type. Searches both directions. |
| `get_events` | Plot events up to your position, or just one character's |
| `find_connection` | Shortest path between two characters you have met |

---

## What it shows you that a wiki cannot

At book 1 of The Empyrean:

```
Brennan Sorrengail (brennan)
Violet's brother (presumed dead)
Status: dead — as far as you know at this point
(Biography withheld — it describes later books.)
```

He is alive. You do not find out until the final paragraph of *Fourth Wing*, so the server tells you what **you** know, not what is true. At book 2 the same call reports him alive with no caveat.

Panchek behaves the same way in reverse: he is a venin spy from book 1, and the server keeps that from you until *Onyx Storm* exposes him.

Biographies are withheld entirely below the final book. They are written as whole-series prose — `npm run spoiler-audit` counts **25** that name a character who has not appeared yet.

---

## The adversarial test suite

[`tests/mcp.test.ts`](../tests/mcp.test.ts) attacks the boundary from five directions at book 1, where Theophanie and Halden are three books away:

1. **Direct lookup by id** — returns nothing, and does not hint that the name means anything
2. **Fuzzy search** — `theo`, `venin`, `prince`, `halden`; none surface a later character, and the reply does not echo the query
3. **Relationship traversal** from four visible characters — cannot reach them
4. **The event log** — never names them, whole-series or per-character
5. **Path finding** — refuses rather than routing through them

Plus a sweep asserting that **no output from any tool** names any later character, and that biographies stay sealed at books 1–3 and open at book 4.

Writing these found a real leak: the no-match message used to echo the query back, so searching a hidden name returned that name. Fixed by not echoing.

---

## Limits worth stating

**One reader.** Positions are per-process, not per-user. Multi-user would need them keyed by session.

**Not a wiki.** It only knows what the three `data/*.json` files contain — 144 characters across three series. It will not answer questions the charts do not cover, which is deliberate: everything it says is traceable to validated data.

**Read-only.** No tool mutates anything except the reading position.
