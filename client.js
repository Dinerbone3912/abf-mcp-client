#!/usr/bin/env node
/**
 * abf-mcp-client — minimal, zero-dependency MCP client for Agent Bounty Feed.
 *
 * Talks to the Streamable HTTP MCP server at
 *   https://agent-bounty-feed.dailydollar.workers.dev/mcp
 * using plain fetch (Node >= 18). Demonstrates a real MCP handshake
 * (initialize -> notifications/initialized -> tools/call) and prints
 * open, paid bounties an agent can claim.
 *
 * Usage:
 *   node client.js stats
 *   node client.js list [--exclude kyc,stake,bond] [--limit N]
 *   node client.js tool list_bounties '{"limit":5}'
 */

const MCP_URL = process.env.ABF_MCP_URL || 'https://agent-bounty-feed.dailydollar.workers.dev/mcp';
const PROTO = '2024-11-05';

let nextId = 1;
const pending = new Map();
let buffer = '';

/** Parse a Streamable-HTTP response body which may be JSON or SSE (text/event-stream). */
function parseBody(text) {
  const out = [];
  const trimmed = text.trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // plain JSON
    const j = JSON.parse(trimmed);
    Array.isArray(j) ? out.push(...j) : out.push(j);
    return out;
  }
  // SSE: events separated by blank lines, data: lines carry JSON
  for (const event of trimmed.split(/\n\n/)) {
    const data = event.split(/\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (data) { try { out.push(JSON.parse(data)); } catch {} }
  }
  return out;
}

async function rpc(sessionId, method, params, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method };
  if (!notify) body.id = nextId++;
  if (params !== undefined) body.params = params;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id') || sessionId;
  if (notify) { await res.text(); return { sessionId: sid }; }
  const text = await res.text();
  const msgs = parseBody(text);
  const reply = msgs.find(m => m.id === body.id);
  if (!reply) throw new Error(`no reply to ${method}; body: ${text.slice(0, 300)}`);
  if (reply.error) throw new Error(`${method} error: ${JSON.stringify(reply.error)}`);
  return { sessionId: sid, result: reply.result };
}

async function connect() {
  const init = await rpc(null, 'initialize', {
    protocolVersion: PROTO,
    capabilities: {},
    clientInfo: { name: 'abf-mcp-client', version: '1.0.0' },
  });
  const sessionId = init.sessionId;
  await rpc(sessionId, 'notifications/initialized', {}, { notify: true });
  return sessionId;
}

async function callTool(sessionId, name, args = {}) {
  const { result } = await rpc(sessionId, 'tools/call', { name, arguments: args });
  // MCP tools/call returns { content: [{type:'text', text:'...'}], isError? }
  if (result?.isError) throw new Error(`tool ${name} returned error: ${JSON.stringify(result)}`);
  const text = (result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}

function fmtItem(b) {
  const reward = b.reward?.amount != null
    ? `${b.reward.amount} ${b.reward.currency || b.reward.symbol || ''}`.trim()
    : (b.reward_usd != null ? `$${b.reward_usd}` : '?');
  const url = b.url || b.html_url || '';
  return `- [${reward}] ${b.title || '(no title)'}\n  ${url}`.trimEnd();
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  }
  return flags;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const sessionId = await connect();

  if (cmd === 'stats') {
    const stats = await callTool(sessionId, 'get_feed_stats', {});
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  if (cmd === 'list') {
    const flags = parseFlags(rest);
    const args = {};
    if (flags.exclude) args.exclude_requires = String(flags.exclude).split(',');
    if (flags.limit) args.limit = Number(flags.limit);
    const items = await callTool(sessionId, 'list_bounties', args);
    const list = Array.isArray(items) ? items : (items.bounties || items.items || []);
    console.log(`Open paid bounties (${list.length}):\n`);
    for (const b of list) console.log(fmtItem(b) + '\n');
    return;
  }
  if (cmd === 'tool') {
    const [name, json] = rest;
    const args = json ? JSON.parse(json) : {};
    const out = await callTool(sessionId, name, args);
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.error('Usage: node client.js <stats|list|tool> ...');
  process.exit(2);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
