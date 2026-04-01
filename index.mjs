#!/usr/bin/env node

/**
 * local_fetch — stdio MCP server for localhost/LAN HTTP fetching.
 *
 * OpenClaw's built-in web_fetch blocks private/internal network addresses
 * via its SSRF guard. This MCP server intentionally bypasses that restriction
 * for local and LAN targets ONLY. It will refuse to fetch public internet URLs.
 *
 * Register in openclaw.json:
 *   "plugins": [{
 *     "type": "stdio",
 *     "id": "local-fetch",
 *     "name": "local-fetch",
 *     "command": "node",
 *     "args": ["/path/to/local-fetch-mcp/index.mjs"]
 *   }]
 */

import { createInterface } from "node:readline";
import { URL } from "node:url";
import net from "node:net";
import dns from "node:dns/promises";

// ── Private/LAN detection ────────────────────────────────────────────────────

const LOCALHOST_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

function isLoopbackIP(ip) {
  // 127.0.0.0/8 or ::1
  return ip === "::1" || ip.startsWith("127.");
}

function isPrivateIPv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 link-local
  return false;
}

function isPrivateIPv6(ip) {
  if (!net.isIPv6(ip)) return false;
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80")) return true;  // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  return false;
}

async function isAllowedTarget(hostname) {
  // Known localhost hostnames
  if (LOCALHOST_HOSTNAMES.has(hostname.toLowerCase())) return true;

  // Bare IP literals
  if (net.isIP(hostname)) {
    return isLoopbackIP(hostname) || isPrivateIPv4(hostname) || isPrivateIPv6(hostname);
  }

  // Resolve hostname and check all addresses
  try {
    const addrs = await dns.resolve4(hostname).catch(() => []);
    const addrs6 = await dns.resolve6(hostname).catch(() => []);
    const all = [...addrs, ...addrs6];
    if (all.length === 0) return false;
    return all.every(
      (ip) => isLoopbackIP(ip) || isPrivateIPv4(ip) || isPrivateIPv6(ip)
    );
  } catch {
    return false;
  }
}

// ── Tool definition ──────────────────────────────────────────────────────────

const TOOL = {
  name: "local_fetch",
  description:
    "Fetch a URL from localhost or the local network (LAN). " +
    "Use this tool when you need to reach a local web server, API, or service " +
    "running on this machine or on the local network (127.x, 10.x, 192.168.x, 172.16-31.x). " +
    "This tool ONLY works for private/internal network addresses and will refuse public internet URLs.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to fetch (must be a localhost or LAN address).",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        description: "HTTP method. Defaults to GET.",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional HTTP headers as key-value pairs.",
      },
      body: {
        type: "string",
        description: "Optional request body (for POST/PUT/PATCH).",
      },
    },
    required: ["url"],
  },
};

// ── MCP JSON-RPC handling ────────────────────────────────────────────────────

function respond(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function respondError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "local-fetch", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") {
    return; // no response needed
  }

  if (method === "tools/list") {
    return respond(id, { tools: [TOOL] });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name !== "local_fetch") {
      return respondError(id, -32601, `Unknown tool: ${name}`);
    }

    try {
      const result = await doFetch(args);
      return respond(id, result);
    } catch (err) {
      return respond(id, {
        isError: true,
        content: [{ type: "text", text: `Error: ${err.message}` }],
      });
    }
  }

  if (method === "ping") {
    return respond(id, {});
  }

  // Ignore unknown notifications (no id)
  if (id != null) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

async function doFetch(args) {
  const { url: rawUrl, method = "GET", headers = {}, body } = args;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Only http/https supported, got ${parsed.protocol}`);
  }

  const allowed = await isAllowedTarget(parsed.hostname);
  if (!allowed) {
    throw new Error(
      `Refused: ${parsed.hostname} is not a localhost or LAN address. ` +
      `This tool only fetches from private/internal network targets.`
    );
  }

  const fetchOpts = { method, headers };
  if (body && !["GET", "HEAD"].includes(method)) {
    fetchOpts.body = body;
  }

  const res = await fetch(rawUrl, fetchOpts);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  return {
    content: [
      {
        type: "text",
        text:
          `HTTP ${res.status} ${res.statusText}\n` +
          `Content-Type: ${contentType}\n\n` +
          text,
      },
    ],
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    handleRequest(req);
  } catch {
    respondError(null, -32700, "Parse error");
  }
});
