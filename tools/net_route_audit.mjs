#!/usr/bin/env node
/**
 * net_route_audit.mjs — 上游 host「直连 vs 代理」路由归类 + NO_PROXY 收敛
 * ---------------------------------------------------------------------------
 * 背景：本机用 7890(ClashMi) 代理托底被墙站点，但很多 geo/科学/相机类上游
 *       恰恰是「直连可达、走代理反被 ECONNRESET」。它们被代理一挡，就表现为
 *       数据源"down"，其实是"假 down"。本工具把每个上游 host 同时用「直连」
 *       与「经代理」各探一次，归类后把「直连可达+代理失败」的 host 并入
 *       start-dev.cmd 的 NO_PROXY（只增不删，绝不误删"必须走代理"的条目）。
 *
 * 用法：
 *   node tools/net_route_audit.mjs                 # 扫描（host 自动从 server 代码 + start-dev.cmd 抽取）
 *   node tools/net_route_audit.mjs --sync          # 扫描并把 ADD 组并入 start-dev.cmd 的 NO_PROXY（只增不删）
 *   node tools/net_route_audit.mjs --hosts a.com,b.com
 *   node tools/net_route_audit.mjs --urls urls.json   # {"host":"https://host/some/path"} 覆盖探测 URL（默认 https://host/）
 *   node tools/net_route_audit.mjs --proxy http://127.0.0.1:7890 --timeout 10000 --json
 *
 * 退出码：0 正常；2 有 BOTH_ERR（两者都不可达，通常是上游真挂/需鉴权）。
 *
 * 原理：代理只能用 undici 的 env-proxy 在「进程启动时」生效，故本脚本以
 *       「父进程编排 → 子进程分别用 直连env / 代理env 各跑一遍 --phase」实现，
 *       代理子进程强制 NO_PROXY='' 以确保真的走代理（不被既有 NO_PROXY 绕开）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF = fileURLToPath(import.meta.url);
const START_DEV = path.join(ROOT, 'start-dev.cmd');
const SKIP = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// ---------- 参数 ----------
function parseArgs(argv) {
  const a = { sync: false, json: false, proxy: 'http://127.0.0.1:7890',
    timeout: 10000, hosts: null, urls: null, phase: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--sync') a.sync = true;
    else if (k === '--json') a.json = true;
    else if (k === '--hosts') a.hosts = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--urls') a.urls = argv[++i];
    else if (k === '--proxy') a.proxy = argv[++i];
    else if (k === '--timeout') a.timeout = Number(argv[++i]) || 10000;
    else if (k === '--phase') a.phase = argv[++i];
  }
  return a;
}

// ---------- host 抽取 ----------
function walkJs(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.git') walkJs(p, out); }
    else if (e.endsWith('.js') || e.endsWith('.mjs')) out.push(p);
  }
  return out;
}
function hostsFromCode() {
  const hosts = new Set();
  const roots = [path.join(ROOT, 'server', 'providers'), path.join(ROOT, 'server', 'standalone')];
  for (const r of roots) for (const f of walkJs(r)) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(/https:\/\/([a-zA-Z0-9._-]+)/g)) hosts.add(m[1].toLowerCase());
  }
  return [...hosts];
}
function hostsFromNoProxy() {
  let txt; try { txt = readFileSync(START_DEV, 'utf8'); } catch { return []; }
  const m = txt.match(/set "NO_PROXY=([^"]*)"/);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^\./, '')).filter(h => h && !SKIP.has(h));
}

// ---------- 单阶段探测（子进程） ----------
async function runPhase(a) {
  const urls = a.urls ? JSON.parse(readFileSync(a.urls, 'utf8')) : {};
  const out = [];
  await Promise.all(a.hosts.map(async (h) => {
    const url = urls[h] || `https://${h}/`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(a.timeout),
        redirect: 'follow', headers: { 'User-Agent': 'gods-eye-net-audit/1.0' } });
      await r.body?.cancel?.().catch(() => {});
      out.push({ h, ok: true, status: r.status });
    } catch (e) {
      out.push({ h, ok: false, code: (e.cause && e.cause.code) || e.name || 'ERR' });
    }
  }));
  process.stdout.write(JSON.stringify(out));
}

// ---------- 编排：跑两个阶段 ----------
function runPhaseChild(a, phase) {
  const env = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'])
    delete env[k];
  if (phase === 'proxy') {
    env.NODE_USE_ENV_PROXY = '1';
    env.HTTP_PROXY = env.HTTPS_PROXY = env.http_proxy = env.https_proxy = a.proxy;
    env.NO_PROXY = env.no_proxy = ''; // 强制真走代理
  }
  const res = spawnSync(process.execPath, [SELF, '--phase', phase, '--timeout', String(a.timeout),
    '--hosts', a.hosts.join(','), ...(a.urls ? ['--urls', a.urls] : [])],
    { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`phase ${phase} failed: ${res.stderr || res.status}`);
  return JSON.parse(res.stdout);
}

// ---------- NO_PROXY 收敛（只增不删） ----------
function syncNoProxy(addHosts) {
  let txt = readFileSync(START_DEV, 'utf8');
  const m = txt.match(/set "NO_PROXY=([^"]*)"/);
  if (!m) throw new Error('start-dev.cmd 里找不到 set "NO_PROXY=..."');
  const cur = m[1].split(',').map(s => s.trim()).filter(Boolean);
  const bare = new Set(cur.map(s => s.toLowerCase().replace(/^\./, '')));
  const added = [];
  for (const h of addHosts) {
    if (bare.has(h.toLowerCase())) continue;   // 已是直连（任一形式），跳过
    cur.push(h, `.${h}`);                       // host 精确 + .host 子域通配
    bare.add(h.toLowerCase());
    added.push(h);
  }
  if (!added.length) return { changed: false, added: [] };
  const line = `set "NO_PROXY=${cur.join(',')}"`;
  txt = txt.replace(/set "NO_PROXY=[^"]*"/, line);
  writeFileSync(START_DEV, txt);
  return { changed: true, added };
}

// ---------- main ----------
(async () => {
  const a = parseArgs(process.argv.slice(2));

  if (a.phase) { await runPhase(a); return; }

  const hosts = a.hosts
    ? [...new Set(a.hosts)]
    : [...new Set([...hostsFromCode(), ...hostsFromNoProxy()])].filter(h => !SKIP.has(h)).sort();

  if (!hosts.length) { console.error('没有可探测的 host'); process.exit(1); }
  a.hosts = hosts;

  const [dir, prx] = [runPhaseChild(a, 'direct'), runPhaseChild(a, 'proxy')];
  const D = Object.fromEntries(dir.map(x => [x.h, x]));
  const P = Object.fromEntries(prx.map(x => [x.h, x]));
  const ADD = [], KEEP = [], BOTH_OK = [], BOTH_ERR = [];
  for (const h of hosts) {
    const d = D[h]?.ok, p = P[h]?.ok;
    if (d && !p) ADD.push(h);
    else if (!d && p) KEEP.push(h);
    else if (d && p) BOTH_OK.push(h);
    else BOTH_ERR.push(`${h} (${D[h]?.code}/${P[h]?.code})`);
  }

  if (a.json) {
    process.stdout.write(JSON.stringify({ ADD, KEEP_PROXY: KEEP, BOTH_OK, BOTH_ERR, total: hosts.length }, null, 2) + '\n');
  } else {
    console.log(`\n扫描 ${hosts.length} 个 host（直连 vs ${a.proxy}）\n`);
    console.log(`=== ADD：直连可达+代理失败 → 应加 NO_PROXY (${ADD.length}) ===\n${ADD.join(', ') || '(无)'}\n`);
    console.log(`=== KEEP_PROXY：直连失败+代理可达 → 必须走代理，勿加 (${KEEP.length}) ===\n${KEEP.join(', ') || '(无)'}\n`);
    console.log(`=== BOTH_ERR：两者都不可达（真挂/需鉴权/超时） (${BOTH_ERR.length}) ===\n${BOTH_ERR.join(', ') || '(无)'}\n`);
    console.log(`=== BOTH_OK：两者都可达 (${BOTH_OK.length}) ===\n${BOTH_OK.join(', ') || '(无)'}\n`);
  }

  if (a.sync) {
    const r = syncNoProxy(ADD);
    if (r.changed) console.log(`✅ start-dev.cmd NO_PROXY 已并入 ${r.added.length} 项：\n   ${r.added.join(', ')}\n   重启 dev server 生效：先 netstat 找 4173 PID → Stop-Process，再跑 start-dev.cmd`);
    else console.log('✅ NO_PROXY 已是全集，无需改动');
  }
  process.exit(BOTH_ERR.length ? 2 : 0);
})().catch(e => { console.error('net_route_audit error:', e?.message || e); process.exit(1); });
