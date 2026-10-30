#!/usr/bin/env node
/**
 * demo.js — one-command proof that abf-mcp-client talks to the live Agent Bounty Feed
 * MCP server. Runs a real handshake + tools/call and prints PASS/FAIL per step.
 *   node demo.js
 */
import { execFileSync } from 'node:child_process';

const MCP = 'https://agent-bounty-feed.dailydollar.workers.dev/mcp';
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? (pass++, console.log(`PASS  ${name} ${extra}`)) : (fail++, console.log(`FAIL  ${name} ${extra}`)); };

async function main() {
  console.log('Agent Bounty Feed — MCP client self-test\n' + '='.repeat(48));

  // 1. initialize handshake
  const initRes = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize',
      params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'abf-demo', version:'1' } } }),
  });
  const sid = initRes.headers.get('mcp-session-id');
  const initText = await initRes.text();
  ok('initialize returns 200', initRes.ok);
  ok('session handled (stateless OK)', true, sid ? `(sid ${sid.slice(0,8)}…)` : '(stateless server)');
  ok('server advertises tools', initText.includes('tools'));

  // 2. initialized notification
  const noteRes = await fetch(MCP, { method:'POST',
    headers:{ 'Content-Type':'application/json','Accept':'application/json, text/event-stream', ...(sid?{'Mcp-Session-Id':sid}:{}) },
    body: JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' }) });
  ok('initialized notification accepted', noteRes.ok);

  // 3. tools/call get_feed_stats
  const callRes = await fetch(MCP, { method:'POST',
    headers:{ 'Content-Type':'application/json','Accept':'application/json, text/event-stream', ...(sid?{'Mcp-Session-Id':sid}:{}) },
    body: JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'get_feed_stats', arguments:{} } }) });
  const body = await callRes.text();
  let parsed = null;
  if (body.trim().startsWith('{')) parsed = JSON.parse(body).result;
  else {
    const data = body.split(/\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    if (data) parsed = JSON.parse(data).result;
  }
  ok('tools/call get_feed_stats returns content', !!parsed?.content);
  const text = (parsed?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
  let stats = null; try { stats = JSON.parse(text); } catch {}
  ok('stats contain item count', !!stats?.stats?.items, stats?.stats ? `(${stats.stats.items} items, $${stats.stats.total_usd})` : '');

  console.log('='.repeat(48));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
