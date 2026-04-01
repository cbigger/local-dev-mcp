# local-fetch-mcp

A tiny stdio MCP server that lets [OpenClaw](https://github.com/openclaw/openclaw) fetch from localhost and LAN addresses.

## Why

OpenClaw's built-in `web_fetch` tool blocks all private/internal network addresses via its SSRF guard — `localhost`, `127.x`, `10.x`, `192.168.x`, `172.16-31.x` are all rejected. There is currently no config-level opt-in for `web_fetch` to reach local services ([#39604](https://github.com/openclaw/openclaw/issues/39604)).

This MCP server sidesteps the issue entirely. It exposes a single `local_fetch` tool that **only** works with private/internal network targets and refuses all public internet URLs — the inverse of the built-in SSRF policy.

## Requirements

- Node.js 18+
- No dependencies — uses only Node builtins.

## Setup

Clone or copy the repo somewhere persistent:

```sh
git clone https://github.com/youruser/local-fetch-mcp.git ~/.openclaw/workspace/local-fetch-mcp
```

Register it with OpenClaw:

```sh
openclaw mcp set local-fetch '{"command":"node","args":["/home/youruser/.openclaw/workspace/local-fetch-mcp/index.mjs"]}'
```

Or add it to `~/.openclaw/openclaw.json` manually:

```json
{
  "mcp": {
    "servers": {
      "local-fetch": {
        "command": "node",
        "args": ["/home/youruser/.openclaw/workspace/local-fetch-mcp/index.mjs"]
      }
    }
  }
}
```

Restart the gateway and the tool will be available to your agents as `local-fetch__local_fetch`.

## Allowed targets

The tool resolves the hostname and checks that **all** resolved addresses fall within private/internal ranges before making the request:

- `localhost`, `localhost.localdomain`
- `127.0.0.0/8`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.0.0/16` (link-local)
- `::1`, `fe80::` (IPv6 link-local), `fc00::/7` (IPv6 ULA)

Any URL that resolves to a public address is refused.

## Tool schema

**`local_fetch`** — Fetch a URL from localhost or the local network.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `url`     | string | yes      | Full URL (must be a private/LAN address) |
| `method`  | string | no       | HTTP method, defaults to `GET`           |
| `headers` | object | no       | Key-value pairs for request headers      |
| `body`    | string | no       | Request body (for POST/PUT/PATCH)        |

## License

MIT
