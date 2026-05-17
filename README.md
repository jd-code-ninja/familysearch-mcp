# FamilySearch MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [FamilySearch](https://www.familysearch.org) REST API endpoints as MCP tools. Enables AI assistants to query family tree data, persons, relationships, places, sources, and more.

## Features

- **Full API coverage** — persons, pedigree, relationships, places, sources, memories, collections, and system endpoints
- **Automatic auth** — extracts your FamilySearch session from browser cookies (Arc, Chrome, Firefox)
- **No API key needed** — uses your existing browser login

## Prerequisites

- Node.js 18+
- Python 3 with `browser-cookie3` (`pip3 install browser-cookie3`)
- A FamilySearch account (logged in via browser)

## Setup

```bash
git clone <repo-url>
cd familysearch-mcp
npm install
pip3 install browser-cookie3
npm run build
```

> **Note:** `browser-cookie3` reads your browser's SQLite cookie database directly. Some browsers (Chrome, Arc, Brave) lock the database when running, so you may need to close the browser before extracting cookies for the first time. Once `session.json` is saved, the browser can be reopened.

## Usage

The server communicates via stdio transport (standard MCP protocol). Configure your MCP client to point to:

```
node /path/to/familysearch-mcp/dist/index.js
```

On first run, it extracts cookies from your browser automatically. Session persists in `~/.familysearch-mcp/session.json` and refreshes after 24 hours.

### OpenCode Configuration

To use with [OpenCode](https://opencode.ai), add an entry under `mcp` in your `opencode.json`:

```json
{
  "mcp": {
    "familysearch": {
      "command": "node",
      "args": ["/path/to/familysearch-mcp/dist/index.js"]
    }
  }
}
```

Place this in your project's `opencode.json` or in `~/.opencode/bin/opencode.json` for global availability.

## Tools

### Person & Tree
- `get-person` — person details by ID
- `get-ancestors` — up to 8 generations
- `get-descendants` — up to 3 generations
- `get-children`, `get-parents`, `get-spouses`, `get-families`
- `get-current-tree-person`
- `get-person-change-history`, `get-person-notes`, `get-person-sources`
- `get-person-memories`, `get-person-portrait`, `get-person-matches`
- `search-persons`

### Relationships
- `get-relationship-finder`
- `get-couple-relationship`, `get-child-relationship`

### Places
- `search-places`, `get-place`, `get-place-description`, `get-place-description-children`

### Sources & Memories
- `get-source-description`, `get-source-folders`
- `get-user-memories`

### System
- `get-current-user`, `get-collections`, `get-home`
- `get-pending-modifications`, `get-agent`
- `authenticate`, `say-hello`

## License

MIT
