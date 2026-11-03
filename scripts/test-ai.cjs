// Checks the AI tutor against a simulated Claude API: what is sent, streaming, history, errors.
// Run with: node scripts/test-ai.cjs
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Tutor } = require('../electron/ai.cjs');

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const answer = (text) => sse([
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 5) } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(5) } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 80 } },
  { type: 'message_stop' },
]);

const requests = [];
let mode = 'ok';
const fakeFetch = async (url, init) => {
  requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) });
  if (mode === 'auth') return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  return new Response(answer('Hallo! Schau dir Zeile 3 an.'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-ai-'));
  const events = [];
  const safeStorage = { isEncryptionAvailable: () => false };
  const tutor = new Tutor({ dir, safeStorage, emit: (e) => events.push(e), clientOptions: { fetch: fakeFetch } });
  tutor.setKey('sk-ant-test', false);
  tutor.newChat({ lang: 'de', mode: 'hints' });

  await tutor.send({ text: 'Was macht diese Klasse?', context: { file: 'Hund.java', content: 'public class Hund {\n}\n', classes: ['Hund'] }, model: 'claude-opus-5-5', lang: 'de', mode: 'hints', turnId: 't1' });
  const r1 = requests[0];
  assert.ok(r1.url.startsWith('https://api.anthropic.com/v1/messages'), r1.url);
  assert.strictEqual(r1.headers.authorization, 'Bearer sk-ant-test');
  assert.ok((r1.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01'), JSON.stringify(r1.headers));
  assert.strictEqual(r1.body.model, 'claude-opus-5-5');
  assert.strictEqual(r1.body.fallbacks, 'default');
  assert.strictEqual(r1.body.stream, true);
  assert.deepStrictEqual(r1.body.output_config, { effort: 'medium' });
  assert.ok(!('thinking' in r1.body) && !('temperature' in r1.body) && !('betas' in r1.body));
  assert.ok(r1.body.system.includes('Modus: Tipps'));
  assert.strictEqual(r1.body.messages.length, 1);
  assert.ok(r1.body.messages[0].content[0].text.includes('1| public class Hund {'));
  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.usage.input === 1200 && done.usage.output === 80, JSON.stringify(events));
  assert.strictEqual(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Hallo! Schau dir Zeile 3 an.');
  assert.ok(events.some((e) => e.type === 'thinking'));
  console.log('  ok   first turn: headers, body, streaming, usage');

  await tutor.send({ text: 'Und jetzt?', context: { file: 'Hund.java', content: 'public class Hund {\n}\n' }, model: 'claude-opus-5-5', lang: 'de', mode: 'hints', turnId: 't2' });
  const r2 = requests[1];
  assert.strictEqual(r2.body.messages.length, 3);
  assert.strictEqual(r2.body.system, r1.body.system, 'system prompt stays frozen');
  assert.deepStrictEqual(r2.body.messages[0], r1.body.messages[0], 'history is append-only');
  assert.ok(r2.body.messages[1].content.some((b) => b.type === 'thinking'), 'thinking block is replayed');
  assert.ok(r2.body.messages[2].content[0].text.includes('unverändert'), 'unchanged file is not resent');
  console.log('  ok   second turn: frozen system, append-only history, file not resent');

  await tutor.send({ text: 'Hi', model: 'claude-haiku-5-5', lang: 'de', mode: 'hints', turnId: 't3' });
  const r3 = requests[2];
  assert.ok(!('fallbacks' in r3.body) && !(r3.headers['anthropic-beta'] || '').includes('fallback'), 'no fallbacks for Haiku');
  console.log('  ok   Haiku request without fallbacks');

  mode = 'auth';
  const before = tutor.messages.length;
  await tutor.send({ text: 'Noch was', model: 'claude-opus-5-5', lang: 'de', mode: 'hints', turnId: 't4' });
  const err = events.find((e) => e.turnId === 't4' && e.type === 'error');
  assert.ok(err && err.code === 'auth', JSON.stringify(events.filter((e) => e.turnId === 't4')));
  assert.strictEqual(tutor.messages.length, before, 'failed question is taken back off the history');
  console.log('  ok   rejected key maps to "auth" and keeps history clean');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nall AI checks passed');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
