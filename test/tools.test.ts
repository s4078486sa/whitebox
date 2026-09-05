/**
 * Correctness tests for the pure tool logic.
 *
 * Verified against known-answer vectors (RFC 4648, RFC 6238, RFC 2104) rather
 * than against my own implementation — a test that just re-runs the code under
 * test proves nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { base64, urlcodec, hexcodec, jwt } from '../src/lib/tools/encode.ts';
import { uuid, hash, hmac, totp, password, keypair } from '../src/lib/tools/generate.ts';
import { json, configconv, timestamp, numbase, color, csvjson, cron } from '../src/lib/tools/convert.ts';
import { regex, diff, casing, cidr, textstats } from '../src/lib/tools/inspect.ts';
import { sniff } from '../src/lib/sniff.ts';
import { layoutOf } from '../src/lib/types.ts';
import { TOOLS, IMPLS } from '../src/lib/registry.ts';

const run = async (pair, values) => await pair[1].run(values);

/** find-or-fail: keeps strict null checks satisfied without `!` everywhere. */
function tool(slug) {
  const t = TOOLS.find((x) => x.slug === slug);
  assert.ok(t, `no such tool: ${slug}`);
  return t;
}
function field(slug, id) {
  const f = tool(slug).inputs.find((x) => x.id === id);
  assert.ok(f, `${slug} has no field ${id}`);
  return f;
}

const text = (res) => res.text ?? res.blocks?.[0]?.text ?? '';
const blockLabelled = (res, label) => res.blocks.find((b) => b.label === label)?.text ?? '';

// ── base64: RFC 4648 test vectors ─────────────────────────
test('base64 matches RFC 4648 vectors', async () => {
  const vectors = [['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']];
  for (const [plain, encoded] of vectors) {
    assert.equal(text(await run(base64, { text: plain, dir: 'encode', variant: 'std' })), encoded);
    assert.equal(text(await run(base64, { text: encoded, dir: 'decode', variant: 'std' })), plain);
  }
});

test('base64 round-trips multibyte UTF-8', async () => {
  const s = '白盒 Whitebox 🧰';
  const e = text(await run(base64, { text: s, dir: 'encode', variant: 'std' }));
  assert.equal(text(await run(base64, { text: e, dir: 'decode', variant: 'std' })), s);
});

test('base64 url-safe variant strips padding and swaps alphabet', async () => {
  const out = text(await run(base64, { text: '~~~~~~', dir: 'encode', variant: 'url' }));
  assert.ok(!out.includes('='), 'padding should be stripped');
  assert.ok(!out.includes('+') && !out.includes('/'), 'alphabet should be url-safe');
  assert.equal(text(await run(base64, { text: out, dir: 'decode', variant: 'url' })), '~~~~~~');
});

test('base64 rejects invalid input with a useful message', async () => {
  await assert.rejects(() => run(base64, { text: '!!!not base64!!!', dir: 'decode', variant: 'std' }), /Base64/);
});

// ── url ───────────────────────────────────────────────────
test('url component mode escapes separators, full mode does not', async () => {
  const v = { text: 'a=1&b=2', dir: 'encode' };
  assert.equal(text(await run(urlcodec, { ...v, mode: 'component' })), 'a%3D1%26b%3D2');
  assert.equal(text(await run(urlcodec, { ...v, mode: 'full' })), 'a=1&b=2');
});

test('url decode reports incomplete escape instead of throwing raw', async () => {
  await assert.rejects(() => run(urlcodec, { text: '%E4%B8', dir: 'decode', mode: 'component' }), /转义序列/);
});

// ── hex ───────────────────────────────────────────────────
test('hex encodes utf-8 and round-trips', async () => {
  const enc = text(await run(hexcodec, { text: 'Hi', dir: 'encode', sep: 'none', upper: false }));
  assert.equal(enc, '4869');
  assert.equal(text(await run(hexcodec, { text: '48 69', dir: 'decode', sep: 'none' })), 'Hi');
});

test('hex rejects odd digit count with the count in the message', async () => {
  await assert.rejects(() => run(hexcodec, { text: 'abc', dir: 'decode' }), /奇数.*3/s);
});

// ── jwt ───────────────────────────────────────────────────
test('jwt splits segments and decodes claims', async () => {
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const res = await run(jwt, { token });
  assert.match(blockLabelled(res, 'Header'), /"alg": "HS256"/);
  assert.match(blockLabelled(res, 'Payload'), /"name": "John Doe"/);
  assert.match(blockLabelled(res, '时间声明'), /iat \(签发\)\s+2018-01-18/);
  assert.match(blockLabelled(res, 'Signature'), /SflKxw/);
});

test('jwt strips a Bearer prefix', async () => {
  const token =
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.x';
  const res = await run(jwt, { token });
  assert.match(blockLabelled(res, 'Payload'), /"sub": "1"/);
});

test('jwt says how many segments it actually got', async () => {
  await assert.rejects(() => run(jwt, { token: 'abc.def' }), /只有 2 段/);
});

// ── hash: known-answer vectors ────────────────────────────
test('hash matches published digests for "abc"', async () => {
  const res = await run(hash, { text: 'abc', case: 'lower' });
  const get = (n) => res.blocks.find((b) => b.label === n).text;
  assert.equal(get('MD5'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(get('SHA-1'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(get('SHA-256'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(get('SHA3-256'), '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
  assert.equal(get('CRC32'), '352441c2');
});

test('hash base64 output decodes to the same bytes as hex', async () => {
  const hex = (await run(hash, { text: 'abc', case: 'lower' })).blocks.find((b) => b.label === 'SHA-256').text;
  const b64 = (await run(hash, { text: 'abc', case: 'b64' })).blocks.find((b) => b.label === 'SHA-256').text;
  assert.equal(Buffer.from(b64, 'base64').toString('hex'), hex);
});

// ── hmac: RFC 4231 vector ─────────────────────────────────
test('hmac-sha256 matches RFC 4231 test case 2', async () => {
  const res = await run(hmac, { msg: 'what do ya want for nothing?', key: 'Jefe', alg: 'SHA-256', fmt: 'hex' });
  assert.equal(text(res), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

// ── totp: RFC 6238 vector ─────────────────────────────────
test('totp matches RFC 6238 vector at T=59', async () => {
  // RFC 6238 seed "12345678901234567890" (20 bytes) -> base32 is 32 chars.
  // Passing the 16-char half silently yields a different, plausible-looking
  // code — which is exactly why this test uses a published vector.
  const realNow = Date.now;
  Date.now = () => 59_000;
  try {
    const res = await run(totp, { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', digits: 8, period: 30, alg: 'SHA-1' });
    assert.equal(text(res).replace(/\s/g, ''), '94287082');
  } finally {
    Date.now = realNow;
  }
});

test('totp rejects non-base32 characters by name', async () => {
  await assert.rejects(() => run(totp, { secret: 'ABC1!', digits: 6, period: 30, alg: 'SHA-1' }), /字符 "1"/);
});

// ── uuid ──────────────────────────────────────────────────
test('uuid v4 has correct version and variant nibbles', async () => {
  const out = text(await run(uuid, { ver: 'v4', count: 20 }));
  const lines = out.split('\n');
  assert.equal(lines.length, 20);
  assert.equal(new Set(lines).size, 20, 'must not repeat');
  for (const u of lines) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('uuid v7 is version 7 and monotonic across a batch', async () => {
  const lines = text(await run(uuid, { ver: 'v7', count: 30 })).split('\n');
  for (const u of lines) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const prefixes = lines.map((u) => u.slice(0, 13).replace('-', ''));
  const sorted = [...prefixes].sort();
  assert.deepEqual(prefixes, sorted, 'v7 timestamp prefix must be non-decreasing');
});

// ── password ──────────────────────────────────────────────
test('password respects length, count and charset selection', async () => {
  const res = await run(password, { len: 24, count: 8, lower: true, upper: false, digit: false, sym: false, clear: false });
  const lines = text(res).split('\n');
  assert.equal(lines.length, 8);
  for (const p of lines) {
    assert.equal(p.length, 24);
    assert.match(p, /^[a-z]+$/);
  }
});

test('password with an empty charset is an error, not an empty string', async () => {
  await assert.rejects(() => run(password, { len: 12, count: 1, lower: false, upper: false, digit: false, sym: false }), /至少要选一类/);
});

test('password distribution is not visibly biased', async () => {
  // 8000 chars over a 10-symbol alphabet; a modulo bug skews the low digits hard
  const res = await run(password, { len: 100, count: 80, lower: false, upper: false, digit: true, sym: false, clear: false });
  const chars = text(res).replace(/\n/g, '');
  const counts: Record<string, number> = {};
  for (const c of chars) counts[c] = (counts[c] ?? 0) + 1;
  const freqs = Object.values(counts);
  assert.equal(freqs.length, 10);
  const expected = chars.length / 10;
  for (const f of freqs) assert.ok(Math.abs(f - expected) < expected * 0.25, `frequency ${f} too far from ${expected}`);
});

// ── json ──────────────────────────────────────────────────
test('json reports line and column on a parse error', async () => {
  await assert.rejects(() => run(json, { text: '{\n "a": 1,\n "b": ,\n}', mode: 'pretty', indent: '2' }), /第 3 行第 \d+ 列/);
});

test('json sort is deep and stable', async () => {
  const res = await run(json, { text: '{"b":{"z":1,"a":2},"a":3}', mode: 'min', indent: '2', sort: true });
  assert.equal(text(res), '{"a":3,"b":{"a":2,"z":1}}');
});

// ── yaml/toml ─────────────────────────────────────────────
test('config conversion round-trips json -> yaml -> json', async () => {
  const src = '{"name":"whitebox","n":3,"deep":{"list":[1,2,3]}}';
  const yaml = text(await run(configconv, { text: src, from: 'json', to: 'yaml' }));
  const back = text(await run(configconv, { text: yaml, from: 'yaml', to: 'json' }));
  assert.deepEqual(JSON.parse(back), JSON.parse(src));
});

test('config auto-detection distinguishes toml from yaml', async () => {
  const res = await run(configconv, { text: 'a = 1\n[b]\nc = "x"', from: 'auto', to: 'json' });
  assert.deepEqual(JSON.parse(text(res)), { a: 1, b: { c: 'x' } });
});

test('config explains why toml output failed instead of leaking a stack', async () => {
  await assert.rejects(() => run(configconv, { text: '[1,2,3]', from: 'json', to: 'toml' }), /无法输出为 TOML/);
});

// ── timestamp ─────────────────────────────────────────────
test('timestamp distinguishes seconds from milliseconds', async () => {
  const s = await run(timestamp, { input: '1000000000', tz: 'utc' });
  assert.equal(blockLabelled(s, 'ISO 8601'), '2001-09-09T01:46:40.000Z');
  const ms = await run(timestamp, { input: '1000000000000', tz: 'utc' });
  assert.equal(blockLabelled(ms, 'ISO 8601'), '2001-09-09T01:46:40.000Z');
});

test('timestamp parses ISO input back to the right epoch', async () => {
  const res = await run(timestamp, { input: '2026-09-04T15:42:23Z', tz: 'utc' });
  assert.equal(blockLabelled(res, 'Unix 秒'), '1788536543');
});

test('timestamp names the input it could not parse', async () => {
  await assert.rejects(() => run(timestamp, { input: 'not-a-date', tz: 'utc' }), /"not-a-date"/);
});

// ── number base ───────────────────────────────────────────
test('base conversion handles bigints beyond 2^53', async () => {
  const res = await run(numbase, { num: '18446744073709551615', from: '10' });
  assert.equal(blockLabelled(res, '十六进制'), '0xFFFFFFFFFFFFFFFF');
  assert.match(blockLabelled(res, '位宽'), /^64 bit/);
});

test('base conversion auto-detects prefixes', async () => {
  assert.equal(blockLabelled(await run(numbase, { num: '0xff', from: 'auto' }), '十进制'), '255');
  assert.equal(blockLabelled(await run(numbase, { num: '0b1010', from: 'auto' }), '十进制'), '10');
  assert.equal(blockLabelled(await run(numbase, { num: '0o777', from: 'auto' }), '十进制'), '511');
});

test('base conversion names the offending digit', async () => {
  await assert.rejects(() => run(numbase, { num: '12', from: '2' }), /"2" 不是 2 进制/);
});

// ── color ─────────────────────────────────────────────────
test('color contrast agrees with an independent implementation', async () => {
  // Cross-checked against tools/check-contrast.py, which gates the build.
  // Both compute WCAG 2.x relative luminance; if they ever disagree, one of
  // them is wrong and the tool is the one users would trust.
  const res = await run(color, { c: '#e6edf3', bg: '#0e1217' });
  const ratio = Number(blockLabelled(res, '对比度 vs #0e1217').split(':')[0]);
  assert.ok(Math.abs(ratio - 15.9) < 0.15, `expected ~15.90, got ${ratio}`);
});

test('color muted text passes AA on the dark surface', async () => {
  // The shipped --text-muted, after the value designer proposed was corrected.
  const res = await run(color, { c: '#9aa4b0', bg: '#0e1217' });
  const ratio = Number(blockLabelled(res, '对比度 vs #0e1217').split(':')[0]);
  assert.ok(ratio >= 4.5, `muted text must clear 4.5:1, got ${ratio}`);
});

test('color converts a known value to hsl and oklch', async () => {
  const res = await run(color, { c: '#ff0000', bg: '#ffffff' });
  assert.equal(blockLabelled(res, 'HSL'), 'hsl(0.0, 100.0%, 50.0%)');
  assert.match(blockLabelled(res, 'OKLCH'), /^oklch\(62\.8/);
});

// ── csv ───────────────────────────────────────────────────
test('csv parsing honours quoted delimiters and escaped quotes', async () => {
  const src = 'a,b\n"x,y","he said ""hi"""';
  const res = await run(csvjson, { text: src, dir: 'to-json', delim: ',', types: true });
  assert.deepEqual(JSON.parse(text(res)), [{ a: 'x,y', b: 'he said "hi"' }]);
});

test('csv round-trips through json without losing embedded commas', async () => {
  const src = 'name,note\nWhite,"a, b"';
  const asJson = text(await run(csvjson, { text: src, dir: 'to-json', delim: ',', types: true }));
  const back = text(await run(csvjson, { text: asJson, dir: 'to-csv', delim: ',', types: true }));
  assert.equal(back, src);
});

test('csv type inference produces real numbers and booleans', async () => {
  const res = await run(csvjson, { text: 'n,ok\n42,true', dir: 'to-json', delim: ',', types: true });
  assert.deepEqual(JSON.parse(text(res)), [{ n: 42, ok: true }]);
});

// ── cron ──────────────────────────────────────────────────
test('cron predicts the next runs for a weekday schedule', async () => {
  const res = await run(cron, { expr: '0 9 * * 1', n: 3 });
  const runs = blockLabelled(res, '未来 3 次运行').split('\n');
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.match(r, /09:00 UTC\s+周一$/);
  }
  // strictly increasing, one week apart
  const dates = runs.map((r) => new Date(r.slice(0, 16) + 'Z').getTime());
  assert.equal(dates[1] - dates[0], 7 * 86400_000);
});

test('cron expands step syntax', async () => {
  const res = await run(cron, { expr: '*/15 * * * *', n: 4 });
  const runs = blockLabelled(res, '未来 4 次运行').split('\n');
  const mins = runs.map((r) => Number(r.slice(14, 16)));
  for (const m of mins) assert.ok([0, 15, 30, 45].includes(m), `unexpected minute ${m}`);
});

test('cron warns about OR semantics when both day fields are set', async () => {
  const res = await run(cron, { expr: '0 0 1 * 1', n: 2 });
  assert.match(res.warning, /「或」而非「与」/);
});

test('cron expands @daily and reports the substitution', async () => {
  const res = await run(cron, { expr: '@daily', n: 2 });
  assert.match(blockLabelled(res, '含义'), /每小时|每分钟|0/);
  assert.match(res.blocks[0].meta, /@daily = 0 0 \* \* \*/);
});

test('cron rejects out-of-range values with the range in the message', async () => {
  await assert.rejects(() => run(cron, { expr: '0 25 * * *', n: 2 }), /超出范围 0-23/);
  await assert.rejects(() => run(cron, { expr: '0 0 * *', n: 2 }), /需要 5 段，收到 4 段/);
});

// ── regex ─────────────────────────────────────────────────
test('regex reports syntax errors without a raw engine prefix', async () => {
  await assert.rejects(() => run(regex, { pattern: '([a-z', flags: 'g', text: 'x' }), /正则语法错误/);
});

test('regex finds all matches and captures groups', async () => {
  const res = await run(regex, { pattern: '(\\w+)@(\\w+)', flags: 'g', text: 'a@b c@d', replace: '' });
  assert.match(res.blocks[0].label, /2 处匹配/);
  assert.match(res.blocks[1].html, /<td>a<\/td><td>b<\/td>/);
});

test('regex substitution applies capture references', async () => {
  const res = await run(regex, { pattern: '(\\w+)@(\\w+)', flags: 'g', text: 'a@b', replace: '$2:$1' });
  assert.equal(blockLabelled(res, '替换结果'), 'b:a');
});

test('regex does not hang on an empty-match pattern', async () => {
  const res = await run(regex, { pattern: 'a*', flags: 'g', text: 'bbb', replace: '' });
  assert.ok(res.blocks[0].label.includes('处匹配'));
});

// ── diff ──────────────────────────────────────────────────
test('diff counts additions and deletions', async () => {
  const res = await run(diff, { a: 'one\ntwo\nthree', b: 'one\n2\nthree\nfour', trim: false, case: false });
  assert.match(res.blocks[0].label, /\+2 \/ −1/);
});

test('diff says so when both sides are identical', async () => {
  const res = await run(diff, { a: 'same\ntext', b: 'same\ntext', trim: false, case: false });
  assert.match(res.warning, /完全相同/);
});

test('diff honours the ignore-whitespace option', async () => {
  const res = await run(diff, { a: '  x  ', b: 'x', trim: true, case: false });
  assert.match(res.warning ?? '', /完全相同/);
});

// ── case ──────────────────────────────────────────────────
test('case conversion splits acronyms correctly', async () => {
  const res = await run(casing, { text: 'getHTTPResponseCode' });
  assert.equal(blockLabelled(res, 'snake_case'), 'get_http_response_code');
  assert.equal(blockLabelled(res, 'kebab-case'), 'get-http-response-code');
  assert.equal(blockLabelled(res, 'camelCase'), 'getHttpResponseCode');
  assert.equal(blockLabelled(res, 'PascalCase'), 'GetHttpResponseCode');
});

test('case conversion handles several lines independently', async () => {
  const res = await run(casing, { text: 'user_id\nbackground-color' });
  assert.equal(blockLabelled(res, 'camelCase'), 'userId\nbackgroundColor');
});

// ── cidr ──────────────────────────────────────────────────
test('cidr computes a /24 correctly', async () => {
  const res = await run(cidr, { cidr: '192.168.10.0/24' });
  const body = res.blocks[0].text;
  assert.match(body, /子网掩码\s+255\.255\.255\.0/);
  assert.match(body, /广播地址\s+192\.168\.10\.255/);
  assert.match(body, /可用范围\s+192\.168\.10\.1 – 192\.168\.10\.254/);
  assert.match(body, /可用主机数\s+254/);
  assert.match(body, /私有/);
});

test('cidr handles a host address inside a /26', async () => {
  const res = await run(cidr, { cidr: '192.168.1.55/26' });
  assert.match(res.blocks[0].text, /网络地址\s+192\.168\.1\.0\/26/);
  assert.match(res.blocks[0].text, /广播地址\s+192\.168\.1\.63/);
});

test('cidr computes a /8 without integer overflow', async () => {
  const res = await run(cidr, { cidr: '10.0.0.0/8' });
  assert.match(res.blocks[0].text, /地址总数\s+16,777,216/);
  assert.match(res.blocks[0].text, /可用主机数\s+16,777,214/);
});

test('cidr rejects bad octets and prefixes by name', async () => {
  await assert.rejects(() => run(cidr, { cidr: '999.1.1.1/24' }), /"999" 不是合法/);
  await assert.rejects(() => run(cidr, { cidr: '10.0.0.0/33' }), /应为 0-32/);
});

// ── text stats ────────────────────────────────────────────
test('text stats counts cjk separately from latin words', async () => {
  const res = await run(textstats, { text: '你好 world' });
  assert.match(text(res), /汉字\/假名\/谚文\s+2/);
  assert.match(text(res), /单词（拉丁）\s+1/);
});

// ── sniff: precision matters more than recall ─────────────
test('sniff identifies a jwt above everything else', () => {
  const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc';
  assert.equal(sniff(t)[0].slug, 'jwt');
});

test('sniff identifies json, cidr, cron and colour', () => {
  assert.equal(sniff('{"a":1,"b":[2,3]}')[0].slug, 'json');
  assert.equal(sniff('192.168.10.0/24')[0].slug, 'cidr');
  assert.equal(sniff('*/15 9-17 * * 1-5')[0].slug, 'cron');
  assert.equal(sniff('#58a6ff')[0].slug, 'color');
});

test('sniff offers base64 decode with a preview of the plaintext', () => {
  const c = sniff('SGVsbG8gV29ybGQh').find((x) => x.slug === 'base64');
  assert.ok(c, 'should offer base64');
  assert.match(c.label, /Hello World!/);
  assert.equal(c.params.dir, 'decode');
});

test('sniff stays silent on ordinary search words', () => {
  for (const q of ['password', 'uuid gen', 'hash', '正则表达式', 'timestamp']) {
    assert.deepEqual(sniff(q), [], `should not guess for "${q}"`);
  }
});

test('sniff does not claim every 10-digit number is a timestamp', () => {
  assert.equal(sniff('9999999999').find((c) => c.slug === 'timestamp'), undefined);
  assert.ok(sniff('1788536543').some((c) => c.slug === 'timestamp'));
});

test('sniff returns at most four candidates, one per tool', () => {
  const out = sniff('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc');
  assert.ok(out.length <= 4);
  assert.equal(new Set(out.map((c) => c.slug)).size, out.length);
});

// ── registry invariants ───────────────────────────────────
test('registry is internally consistent', () => {
  assert.equal(TOOLS.length, 25);
  assert.equal(new Set(TOOLS.map((t) => t.slug)).size, TOOLS.length, 'slugs must be unique');
  for (const t of TOOLS) {
    assert.ok(IMPLS[t.slug], `${t.slug} has no implementation`);
    assert.ok(t.inputs.length > 0, `${t.slug} has no inputs`);
    assert.ok(t.aliases.length >= 3, `${t.slug} needs more search aliases`);
    assert.ok(t.blurb.length < 40, `${t.slug} blurb too long for a card`);
    assert.equal(new Set(t.inputs.map((f) => f.id)).size, t.inputs.length, `${t.slug} has duplicate field ids`);
  }
});

test('every secret-bearing tool is marked sensitive', () => {
  for (const slug of ['password', 'keypair', 'jwt', 'hmac', 'totp']) {
    assert.equal(tool(slug).sensitive, true, `${slug} must be sensitive`);
  }
  // and non-secret tools must NOT be, or they lose URL sharing for no reason
  for (const slug of ['cron', 'regex', 'timestamp', 'json', 'base-convert']) {
    assert.notEqual(tool(slug).sensitive, true, `${slug} should allow URL state`);
  }
});

test('layout derivation matches the designer variant split', () => {
  assert.equal(layoutOf(tool('base64')), 'split');
  assert.equal(layoutOf(tool('password')), 'output');
  assert.equal(layoutOf(tool('uuid')), 'output');
  // regex was workbench until a per-page review measured the cost: stacked,
  // the match list sat ~450px under the expression field, so every keystroke
  // in the most interactive tool on the site cost a scroll. Now split.
  assert.equal(layoutOf(tool('regex')), 'split');
  // diff stays workbench — two textareas cannot share one column.
  assert.equal(layoutOf(tool('diff')), 'workbench');
});

test('no tool throws on empty input', async () => {
  for (const t of TOOLS) {
    const values: Record<string, string | number | boolean> = {};
    for (const f of t.inputs) values[f.id] = f.default ?? (f.type === 'checkbox' ? false : '');
    await IMPLS[t.slug]!.run(values); // must not throw
  }
});

// ── qr: our own encoder, so it needs its own known-answer coverage ──
test('qr encodes and lays out the mandatory function patterns', async () => {
  const { encodeQr, qrToSvg } = await import('../src/lib/qr.ts');
  const q = encodeQr('HELLO WORLD', 'M');
  assert.equal(q.size, q.version * 4 + 17);
  assert.equal(q.mode, 'alnum');
  // finder pattern, top-left: dark ring, light gap, dark 3x3 core
  assert.equal(q.modules[0][0], true);
  assert.equal(q.modules[1][1], false);
  assert.equal(q.modules[3][3], true);
  assert.equal(q.modules[7][7], false); // separator
  // timing pattern alternates along row/col 6
  for (let i = 8; i < q.size - 8; i++) assert.equal(q.modules[6][i], i % 2 === 0);
});

test('qr picks the cheapest mode for the content', async () => {
  const { encodeQr } = await import('../src/lib/qr.ts');
  assert.equal(encodeQr('12345', 'L').mode, 'numeric');
  assert.equal(encodeQr('ABC123', 'L').mode, 'alnum');
  assert.equal(encodeQr('hello', 'L').mode, 'byte');
  assert.equal(encodeQr('中文', 'L').mode, 'byte');
});

test('qr grows with content and refuses the impossible', async () => {
  const { encodeQr } = await import('../src/lib/qr.ts');
  assert.ok(encodeQr('x'.repeat(500), 'L').version > encodeQr('hi', 'L').version);
  assert.ok(encodeQr('x'.repeat(100), 'H').version > encodeQr('x'.repeat(100), 'L').version);
  assert.throws(() => encodeQr('x'.repeat(5000), 'H'), /内容太长/);
  assert.throws(() => encodeQr(''), /内容为空/);
});

test('qr svg is well-formed and scales with the module count', async () => {
  const { encodeQr, qrToSvg } = await import('../src/lib/qr.ts');
  const q = encodeQr('https://example.com', 'M');
  const svg = qrToSvg(q, { margin: 4, scale: 8 });
  assert.ok(svg.startsWith('<svg') && svg.includes('</svg>'));
  assert.match(svg, new RegExp(`viewBox="0 0 ${(q.size + 8) * 8} ${(q.size + 8) * 8}"`));
  assert.ok((svg.match(/M\d/g) ?? []).length > 50);
});

// ── palette / navigation (designer review round 2) ────────
import { searchTools, hrefFor } from '../src/lib/palette.ts';

const INDEX = TOOLS.map((t) => ({ slug: t.slug, name: t.name, blurb: t.blurb, aliases: t.aliases }));

test('searchTools ranks exact alias hits above substring hits', () => {
  const hits = searchTools(INDEX, 'md5');
  assert.equal(hits[0].t.slug, 'hash');
});

test('searchTools finds tools by chinese name', () => {
  assert.equal(searchTools(INDEX, '正则')[0].t.slug, 'regex');
  assert.equal(searchTools(INDEX, '密码')[0].t.slug, 'password');
});

test('searchTools returns nothing for an unmatched query', () => {
  assert.deepEqual(searchTools(INDEX, 'zzzznotatool'), []);
});

test('hrefFor maps sniffed values onto the right field id', () => {
  assert.equal(hrefFor('jwt', 'abc.def.ghi'), '/t/jwt/#token=abc.def.ghi');
  assert.equal(hrefFor('cron', '*/5 * * * *'), '/t/cron/#expr=*%2F5+*+*+*+*');
  assert.equal(hrefFor('base64', 'SGVsbG8=', { dir: 'decode' }), '/t/base64/#dir=decode&text=SGVsbG8%3D');
  assert.equal(hrefFor('uuid', ''), '/t/uuid/');
});

test('every field id used by hrefFor exists on its tool', () => {
  const map = { jwt: 'token', cidr: 'cidr', cron: 'expr', color: 'c', timestamp: 'input', 'base-convert': 'num', hmac: 'msg' };
  for (const [slug, fieldId] of Object.entries(map)) {
    assert.ok(tool(slug).inputs.some((f) => f.id === fieldId), `${slug} has no field "${fieldId}"`);
  }
});

test('sniff targets resolve to a real field on the destination tool', () => {
  const probes = ['{"a":1}', '192.168.1.0/24', '*/15 * * * *', '#58a6ff', '1788536543', 'SGVsbG8gV29ybGQh'];
  for (const p of probes) {
    for (const c of sniff(p)) {
      if (!c.value) continue;
      const href = hrefFor(c.slug, c.value, c.params);
      const params = new URLSearchParams(href.split('#')[1]);
      for (const key of params.keys()) {
        assert.ok(tool(c.slug).inputs.some((f) => f.id === key), `${c.slug}: no field "${key}" (from "${p}")`);
      }
    }
  }
});

test('sensitive tools ship a public sample, never a real secret', () => {
  // RFC 6238 vector seed "12345678901234567890"
  assert.equal(field('totp', 'secret').sample, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(field('hmac', 'msg').sample, 'what do ya want for nothing?');
});

test('the totp sample actually produces the RFC 6238 code', async () => {
  const realNow = Date.now;
  Date.now = () => 59_000;
  try {
    const res = await IMPLS.totp.run({
      secret: String(field('totp', 'secret').sample),
      digits: 8, period: 30, alg: 'SHA-1',
    });
    assert.equal(String(res.blocks?.[0]?.text).replace(/\s/g, ''), '94287082');
  } finally {
    Date.now = realNow;
  }
});

test('the hmac sample reproduces the RFC 4231 digest', async () => {
  const res = await IMPLS.hmac.run({
    msg: String(field('hmac', 'msg').sample),
    key: 'Jefe', alg: 'SHA-256', fmt: 'hex',
  });
  assert.equal(res.text, '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

// ── csv: an unterminated quote must be an error, not silent corruption ──
test('csv rejects an unterminated quote instead of silently truncating', async () => {
  // The old parser swallowed this: the field absorbed the rest of the file and
  // the tool emitted plausible-looking JSON. Wrong answers that inspect as
  // right are the worst failure mode a converter can have.
  await assert.rejects(
    () => run(csvjson, { text: 'a,b\n"unclosed', dir: 'to-json', delim: ',', types: true }),
    /引号没有闭合/,
  );
  await assert.rejects(
    () => run(csvjson, { text: 'name\n"a""b', dir: 'to-json', delim: ',', types: true }),
    /第 2 行/,
  );
});

test('csv still accepts properly escaped and multiline quoted fields', async () => {
  const res = await run(csvjson, { text: 'a,b\n1,"x""y"', dir: 'to-json', delim: ',', types: true });
  assert.match(text(res), /"x\\"y"/);
  const multi = await run(csvjson, { text: 'a,b\n"multi\nline",2', dir: 'to-json', delim: ',', types: true });
  assert.match(text(multi), /multi\\nline/);
});

test('csv keeps the last row when the file has no trailing newline', async () => {
  // Regression guard: the unterminated-quote fix initially dropped the flush
  // that emits a final line lacking "\n", silently losing one record.
  const res = await run(csvjson, { text: 'a,b\n1,2\n3,4', dir: 'to-json', delim: ',', types: true });
  const parsed = JSON.parse(text(res));
  assert.equal(parsed.length, 2, 'both data rows must survive');
  assert.deepEqual(parsed[1], { a: 3, b: 4 });
});

// ── layout choices are load-bearing; pin them so they can't drift back ──
test('interactive tools use the side-by-side layout', () => {
  // Both of these shipped stacked, which put the result ~450px below the
  // control you were editing. Measured on the live site before the fix.
  for (const slug of ['hmac', 'regex']) {
    const meta = TOOLS.find((t) => t.slug === slug);
    assert.equal(layoutOf(meta), 'split', `${slug} must stay side-by-side`);
  }
  // diff genuinely needs the workbench: two textareas can't share one column.
  assert.equal(layoutOf(TOOLS.find((t) => t.slug === 'diff')), 'workbench');
});

test('jwt always warns that it does not verify the signature', async () => {
  // A decoded payload reads exactly the same whether or not anyone checked
  // the signature — including for "alg":"none". The caveat has to be loud.
  const tok = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
  const res = await run(jwt, { token: tok });
  assert.match(res.warning ?? '', /不校验签名/);
});

test('jwt keeps the expiry warning and the unsigned caveat together', async () => {
  // exp in the past: both facts matter, so neither may replace the other.
  const expired = 'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ exp: 1000000000 })).toString('base64url') + '.sig';
  const res = await run(jwt, { token: expired });
  assert.match(res.warning ?? '', /过期/);
  assert.match(res.warning ?? '', /不校验签名/);
});

// ── activeWhen: options that do nothing must say so ──
test('mode-dependent options declare when they are meaningless', () => {
  const hex = TOOLS.find((t) => t.slug === 'hex');
  const sep = hex.inputs.find((f) => f.id === 'sep');
  const upper = hex.inputs.find((f) => f.id === 'upper');
  // Separator and case describe how hex is written, so they are inert while
  // hex is being read.
  assert.equal(sep.activeWhen({ dir: 'encode' }), true);
  assert.equal(sep.activeWhen({ dir: 'decode' }), false);
  assert.equal(upper.activeWhen({ dir: 'decode' }), false);

  const json = TOOLS.find((t) => t.slug === 'json');
  const indent = json.inputs.find((f) => f.id === 'indent');
  assert.equal(indent.activeWhen({ mode: 'pretty' }), true);
  for (const mode of ['min', 'escape', 'unescape']) {
    assert.equal(indent.activeWhen({ mode }), false, `indent is inert in ${mode}`);
  }
});

test('every activeWhen tolerates an empty value bag', () => {
  // run() calls these before the first render, when values may be missing.
  for (const t of TOOLS) {
    for (const f of t.inputs) {
      if (f.activeWhen) assert.doesNotThrow(() => f.activeWhen({}), `${t.slug}.${f.id}`);
    }
  }
});

test('direction selects all read source → target', () => {
  // These used to mix "编码 →", "← 解码" and "文本 → Hex" across pages, so the
  // same control meant three different things depending where you were.
  for (const slug of ['base64', 'url', 'html-entities', 'hex', 'unicode', 'csv-json']) {
    const dir = TOOLS.find((t) => t.slug === slug).inputs.find((f) => f.id === 'dir');
    if (!dir) continue;
    for (const o of dir.options) {
      assert.match(o.label, /→/, `${slug}: "${o.label}" should name source → target`);
      assert.doesNotMatch(o.label, /←/, `${slug}: "${o.label}" still uses a back-arrow`);
    }
  }
});

// ── round 3: density rules, wording, warn placement ───────
test('password reports entropy as a metric, not a warning', async () => {
  const res = await run(password, { len: 20, count: 3, lower: true, upper: true, digit: true, sym: true, clear: true });
  assert.equal(res.warning, undefined, 'entropy must not occupy the warning line');
  assert.match(String(res.blocks?.[0]?.meta), /bit 熵/);
});

test('jwt always warns that the signature was not verified', async () => {
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjo0MTAyNDQ0ODAwfQ.x';
  const res = await run(jwt, { token });
  assert.match(String(res.warning), /未对 Signature|未.*验签|签名/);
});

test('keypair and hash keep their genuine hazard warnings', async () => {
  const k = await run(keypair, { alg: 'Ed25519' });
  assert.match(String(k.warning), /刷新即永久丢失/);
  const h = await run(hash, { text: 'x', case: 'lower' });
  assert.match(String(h.warning), /MD5 和 SHA-1/);
});

test('direction selects read as a flow, never a backwards arrow', () => {
  for (const slug of ['base64', 'url', 'html-entities', 'hex', 'unicode', 'csv-json']) {
    const dir = tool(slug).inputs.find((f) => f.id === 'dir');
    assert.ok(dir, `${slug} has no dir field`);
    for (const o of dir.options ?? []) {
      assert.ok(!o.label.startsWith('←'), `${slug}: "${o.label}" points backwards`);
    }
  }
});

test('no field label is the bare word 输出 (collides with the output pane)', () => {
  for (const t of TOOLS) {
    for (const f of t.inputs) {
      assert.notEqual(f.label, '输出', `${t.slug}.${f.id} needs a more specific label`);
    }
  }
});

test('every select option carries its unit', () => {
  const bases = field('base-convert', 'from');
  for (const o of bases.options ?? []) {
    if (o.value === 'auto') continue;
    assert.match(o.label, /进制/, `base option "${o.label}" is missing its unit`);
  }
});

test('hmac and regex use the split layout, not a stack', () => {
  assert.equal(layoutOf(tool('hmac')), 'split');
  assert.equal(layoutOf(tool('regex')), 'split');
});

test('colour inputs fuse the picker into the text field', () => {
  const t = tool('color');
  assert.equal(field('color', 'c').type, 'text-color');
  assert.equal(field('color', 'bg').type, 'text-color');
  assert.ok(!t.inputs.some((f) => f.id === 'picker'), 'the standalone picker row should be gone');
});

test('password asks for the count after the character classes', () => {
  const ids = tool('password').inputs.map((f) => f.id);
  assert.ok(ids.indexOf('count') > ids.indexOf('sym'), 'count should follow the charset choices');
});
