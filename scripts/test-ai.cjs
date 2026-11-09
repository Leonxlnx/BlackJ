// Checks the AI tutor against a simulated Claude API: what is sent, streaming, history, errors,
// and the agent loop with its tools.
// Run with: node scripts/test-ai.cjs
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Tutor } = require('../electron/ai.cjs');
const { TOOLS, validateToolInput, checkPolicy, parseTarget } = require('../electron/agent-tools.cjs');

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const start = () => ({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
const end = (stop) => [{ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } }, { type: 'message_stop' }];

/** A streamed message from blocks: text, thinking, tool_use (input or raw JSON) and fallback. */
function message(blocks, stop) {
  const ev = [start()];
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(0, 5) } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(5) } });
    } else if (b.type === 'thinking') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
    } else if (b.type === 'tool_use') {
      const json = b.raw ?? JSON.stringify(b.input);
      const cut = Math.floor(json.length / 2);
      ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, cut) } });
      ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(cut) } });
    } else if (b.type === 'fallback') {
      ev.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-sonnet-5-5' } } });
    }
    ev.push({ type: 'content_block_stop', index });
  });
  ev.push(...end(stop));
  return sse(ev);
}
const answer = (text) => message([{ type: 'thinking' }, { type: 'text', text }], 'end_turn');
const toolUse = (id, name, input, { text, stop = 'tool_use', raw } = {}) => message([...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input, raw }], stop);

const requests = [];
const queue = [];
let mode = 'ok';
const fakeFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(JSON.stringify(body)) });
  if (mode === 'auth') return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  let next = queue.length ? queue.shift() : answer('Okay.');
  if (typeof next === 'function') next = next(body);
  if (next && next.status) return new Response(JSON.stringify(next.json), { status: next.status, headers: { 'content-type': 'application/json' } });
  return new Response(next, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
const badRequest = { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: bad' } } };

/** Every tool_use has its tool_result in the next (user) message, and no assistant message is empty. */
function historyValid(messages) {
  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    assert.ok(Array.isArray(m.content) ? m.content.length > 0 : !!m.content, 'empty assistant message at ' + i);
    const ids = (m.content || []).filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) return;
    const next = messages[i + 1];
    assert.ok(next && next.role === 'user', 'no user message after tool_use at ' + i);
    for (const id of ids) assert.ok(next.content.some((b) => b.type === 'tool_result' && b.tool_use_id === id), 'missing tool_result for ' + id);
  });
  return true;
}
const sys = (b) => b.system.map((x) => x.text).join('');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = 'claude-opus-5-5';
const AGENT = { mode: 'explain', exercise: false, testFiles: [], readCode: true, readOnly: false };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackj-ai-'));
  const safeStorage = { isEncryptionAvailable: () => false };
  let toolImpl = async () => ({ content: 'ok' });
  const calls = [];
  const runTool = (call, opts) => {
    calls.push(call);
    return toolImpl(call, opts);
  };
  const make = () => {
    const events = [];
    const tutor = new Tutor({ dir, safeStorage, emit: (e) => events.push(e), clientOptions: { fetch: fakeFetch }, runTool });
    tutor.setKey('sk-ant-test', false);
    tutor.newChat({ lang: 'de', mode: 'hints' });
    return { tutor, events };
  };
  const reset = () => {
    requests.length = 0;
    queue.length = 0;
    calls.length = 0;
    toolImpl = async () => ({ content: 'ok' });
  };
  const ask = (tutor, text, turnId, extra = {}) => tutor.send({ text, model: MODEL, lang: 'de', mode: 'hints', turnId, agent: AGENT, ...extra });
  const of = (events, turnId) => events.filter((e) => e.turnId === turnId);
  const lastUser = (msgs) => msgs[msgs.length - 1];

  // ---------------------------------------------------------------- the plain chat
  const { tutor, events } = make();
  await tutor.send({ text: 'Was macht diese Klasse?', context: { file: 'Hund.java', content: 'public class Hund {\n}\n', classes: ['Hund'] }, model: MODEL, lang: 'de', mode: 'hints', turnId: 't1', agent: AGENT });
  const r1 = requests[0];
  assert.ok(r1.url.startsWith('https://api.anthropic.com/v1/messages'), r1.url);
  assert.strictEqual(r1.headers.authorization, 'Bearer sk-ant-test');
  assert.ok((r1.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01'), JSON.stringify(r1.headers));
  assert.ok(!(r1.headers['anthropic-beta'] || '').includes('fine-grained-tool-streaming'));
  assert.strictEqual(r1.body.model, MODEL);
  assert.strictEqual(r1.body.fallbacks, 'default');
  assert.strictEqual(r1.body.stream, true);
  assert.deepStrictEqual(r1.body.output_config, { effort: 'medium' });
  assert.ok(!('thinking' in r1.body) && !('temperature' in r1.body) && !('betas' in r1.body) && !('tool_choice' in r1.body));
  assert.ok(sys(r1.body).includes('Modus: Tipps'));
  assert.strictEqual(r1.body.system[0].cache_control.type, 'ephemeral');
  assert.strictEqual(r1.body.cache_control.type, 'ephemeral');
  assert.ok(Array.isArray(r1.body.tools) && r1.body.tools.length === 20 && r1.body.tools.every((t) => t.eager_input_streaming === true));
  for (const name of ['update_plan', 'look_at_program', 'use_program']) assert.ok(r1.body.tools.some((t) => t.name === name), name);
  assert.strictEqual(r1.body.messages.length, 1);
  assert.ok(r1.body.messages[0].content[0].text.includes('1| public class Hund {'));
  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.usage.input === 1200 && done.usage.output === 80 && done.steps === 1, JSON.stringify(events));
  assert.strictEqual(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'Okay.');
  assert.ok(events.some((e) => e.type === 'thinking'));
  console.log('  ok   first turn: headers, body, tools, caching, streaming, usage');

  await tutor.send({ text: 'Und jetzt?', context: { file: 'Hund.java', content: 'public class Hund {\n}\n' }, model: MODEL, lang: 'de', mode: 'hints', turnId: 't2', agent: AGENT });
  const r2 = requests[1];
  assert.strictEqual(r2.body.messages.length, 3);
  assert.strictEqual(sys(r2.body), sys(r1.body), 'system prompt stays frozen');
  assert.deepStrictEqual(r2.body.tools, r1.body.tools, 'tools stay identical');
  assert.deepStrictEqual(r2.body.messages[0], r1.body.messages[0], 'history is append-only');
  assert.ok(r2.body.messages[1].content.some((b) => b.type === 'thinking'), 'thinking block is replayed');
  assert.ok(r2.body.messages[2].content[0].text.includes('unverändert'), 'unchanged file is not resent');
  console.log('  ok   second turn: frozen system and tools, append-only history, file not resent');

  await tutor.send({ text: 'Hi', model: 'claude-haiku-5-5', lang: 'de', mode: 'hints', turnId: 't3', agent: AGENT });
  const r3 = requests[2];
  assert.ok(!('fallbacks' in r3.body) && !(r3.headers['anthropic-beta'] || '').includes('fallback'), 'no fallbacks for Haiku');
  console.log('  ok   Haiku request without fallbacks');

  mode = 'auth';
  const before = tutor.messages.length;
  await tutor.send({ text: 'Noch was', model: MODEL, lang: 'de', mode: 'hints', turnId: 't4', agent: AGENT });
  const err = events.find((e) => e.turnId === 't4' && e.type === 'error');
  assert.ok(err && err.code === 'auth' && err.partial === false, JSON.stringify(events.filter((e) => e.turnId === 't4')));
  assert.strictEqual(tutor.messages.length, before, 'failed question is taken back off the history');
  console.log('  ok   rejected key maps to "auth" and keeps history clean');
  mode = 'ok';

  // ---------------------------------------------------------------- 1. tool loop
  {
    reset();
    const { tutor: tu, events: ev } = make();
    toolImpl = async () => ({ content: '  1| public class Hund {' });
    queue.push(toolUse('tu_1', 'read_file', { path: 'Hund.java' }, { text: 'Ich schau nach.' }), answer('Fertig.'));
    await ask(tu, 'Lies Hund', 'a1');
    assert.strictEqual(requests.length, 2);
    const m = requests[1].body.messages;
    assert.strictEqual(m.length, 3);
    assert.deepStrictEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
    assert.ok(m[1].content.some((b) => b.type === 'text') && m[1].content.some((b) => b.type === 'tool_use' && b.id === 'tu_1'));
    assert.ok(m[2].content[0].type === 'tool_result' && m[2].content[0].tool_use_id === 'tu_1' && m[2].content[0].content.includes('public class Hund'));
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual({ name: calls[0].name, input: calls[0].input, callId: calls[0].callId, turnId: calls[0].turnId }, { name: 'read_file', input: { path: 'Hund.java' }, callId: 'tu_1', turnId: 'a1' });
    const e = of(ev, 'a1');
    const ts = e.findIndex((x) => x.type === 'toolStart' && x.callId === 'tu_1' && x.step === 1);
    const w2 = e.findIndex((x) => x.type === 'writing' && x.step === 2);
    assert.ok(ts >= 0 && w2 > ts, JSON.stringify(e));
    const d = e.find((x) => x.type === 'done');
    const one = (1200 * 4 + 80 * 20) / 1e6;
    assert.ok(d.steps === 2 && d.usage.input === 2400 && Math.abs(d.cost - 2 * one) < 1e-12, JSON.stringify(d));
    assert.ok(historyValid(tu.messages));
    console.log('  ok   tool loop: result goes back, events in order, usage summed over steps');
  }

  // ---------------------------------------------------------------- 2. parallel calls
  {
    reset();
    const { tutor: tu } = make();
    queue.push(message([{ type: 'tool_use', id: 'tu_a', name: 'get_project', input: {} }, { type: 'tool_use', id: 'tu_b', name: 'read_file', input: { path: 'Hund.java' } }], 'tool_use'), answer('Gut.'));
    await ask(tu, 'Schau', 'a2');
    assert.deepStrictEqual(calls.map((c) => c.callId), ['tu_a', 'tu_b']);
    const res = requests[1].body.messages[2].content;
    assert.deepStrictEqual(res.map((b) => b.tool_use_id), ['tu_a', 'tu_b']);
    assert.ok(historyValid(tu.messages));
    console.log('  ok   two calls in one step: run in block order, both results in one message');
  }

  // ---------------------------------------------------------------- 3. invalid input
  {
    reset();
    const { tutor: tu, events: ev } = make();
    queue.push(toolUse('tu_1', 'edit_file', { path: 'Hund.java', old_text: 'x' }), answer('Nochmal.'));
    await ask(tu, 'Ändere', 'a3');
    assert.strictEqual(calls.length, 0);
    const r = requests[1].body.messages[2].content[0];
    assert.ok(r.is_error === true && r.content.includes('INVALID_INPUT'), JSON.stringify(r));
    assert.ok(of(ev, 'a3').some((x) => x.type === 'done'));
    console.log('  ok   invalid tool input is answered with INVALID_INPUT, nothing runs');
  }

  // ---------------------------------------------------------------- 4. path confinement
  {
    for (const p of ['../x.java', 'a/../../B.java', 'C:/Windows/A.java', 'C:\\A.java', '/etc/A.java', 'notes.txt', 'sub/README.TXT']) {
      assert.ok(validateToolInput('read_file', { path: p }), 'should reject ' + p);
    }
    for (const p of ['Hund.java', 'tiere/Hund.java', 'README.TXT']) assert.strictEqual(validateToolInput('read_file', { path: p }), null, 'should accept ' + p);
    assert.ok(validateToolInput('write_file', { path: 'README.TXT', content: 'x' }));
    reset();
    const { tutor: tu } = make();
    queue.push(toolUse('tu_1', 'write_file', { path: '../Evil.java', content: 'class Evil {}' }), answer('Okay.'));
    await ask(tu, 'Schreib', 'a4');
    assert.strictEqual(calls.length, 0);
    assert.ok(requests[1].body.messages[2].content[0].is_error);
    console.log('  ok   paths outside the project are rejected before anything runs');
  }

  // ---------------------------------------------------------------- 5. policy
  {
    const ex = { mode: 'hints', exercise: true, testFiles: [], readCode: true };
    assert.ok(typeof checkPolicy('edit_file', { path: 'Rechner.java', old_text: 'a', new_text: 'b' }, ex, { tour: false }) === 'string');
    assert.strictEqual(checkPolicy('edit_file', { path: 'Rechner.java', old_text: 'a', new_text: 'b' }, { ...ex, mode: 'explain' }, { tour: false }), null);
    for (const m of ['hints', 'explain']) assert.ok(checkPolicy('edit_file', { path: 'RechnerTest.java', old_text: 'a', new_text: 'b' }, { ...ex, mode: m, testFiles: ['RechnerTest.java'] }, { tour: false }));
    assert.ok(checkPolicy('read_file', { path: 'A.java' }, { readCode: false }, { tour: false }));
    assert.ok(checkPolicy('compile', {}, AGENT, { tour: true }));
    assert.strictEqual(checkPolicy('read_file', { path: 'A.java' }, AGENT, { tour: true }), null);
    assert.ok(checkPolicy('write_file', { path: 'A.java', content: 'x' }, { ...AGENT, readOnly: true }, { tour: false }));
    console.log('  ok   policy: hints in exercises, test files, code off, read-only, running tutorial');
  }

  // ---------------------------------------------------------------- 6. abort during a tool
  {
    reset();
    const { tutor: tu, events: ev } = make();
    toolImpl = () => new Promise(() => {});
    queue.push(toolUse('tu_1', 'compile', {}));
    setTimeout(() => tu.stop(), 20);
    await ask(tu, 'Kompilier', 'a6');
    const e = of(ev, 'a6');
    assert.ok(e.some((x) => x.type === 'aborted' && x.partial === true), JSON.stringify(e));
    assert.ok(e.some((x) => x.type === 'toolCancel' && x.callIds.includes('tu_1')));
    const last = lastUser(tu.messages);
    assert.ok(last.role === 'user' && last.content[0].tool_use_id === 'tu_1' && last.content[0].is_error === true);
    assert.ok(historyValid(tu.messages));
    assert.strictEqual(tu.busy, false);
    await ask(tu, 'Weiter', 'a6b');
    assert.ok(of(ev, 'a6b').some((x) => x.type === 'done'));
    assert.ok(historyValid(requests[requests.length - 1].body.messages));
    console.log('  ok   stop while a tool runs: results filled in, history valid, next message works');
  }

  // ---------------------------------------------------------------- 7. error mid-loop keeps history
  {
    reset();
    const { tutor: tu, events: ev } = make();
    queue.push(toolUse('tu_1', 'get_project', {}), badRequest);
    await ask(tu, 'Mach', 'a7');
    const e = of(ev, 'a7').find((x) => x.type === 'error');
    assert.ok(e && e.code === 'badRequest' && e.partial === true, JSON.stringify(e));
    // The failed step never reached the history: what it streamed is discarded with it.
    assert.ok(of(ev, 'a7').some((x) => x.type === 'discard' && x.step === 2), 'failed step discarded');
    assert.deepStrictEqual(tu.messages.map((x) => x.role), ['user', 'assistant', 'user']);
    assert.ok(historyValid(tu.messages));
    const n = requests.length;
    queue.push(answer('Weiter geht es.'));
    const seen = of(ev, 'a7').length;
    await tu.continue({ turnId: 'a7', model: MODEL, agent: AGENT, stepBase: 2 });
    assert.strictEqual(requests[n].body.messages.length, 3, 'continue adds no new user message');
    // Step numbers go on after the turn's earlier ones, so a discard never hits them.
    assert.ok(of(ev, 'a7').slice(seen).filter((x) => x.step != null || x.n != null).every((x) => (x.step ?? x.n) >= 3), 'continue numbers steps from stepBase');
    assert.ok(of(ev, 'a7').some((x) => x.type === 'done'));
    await assert.rejects(() => tu.continue({ turnId: 'a7', model: MODEL, agent: AGENT }), (x) => x.code === 'nothingToContinue');
    console.log('  ok   API error after a tool round keeps the history; continue resumes it');
  }

  // ---------------------------------------------------------------- 8. step limit
  {
    reset();
    const { tutor: tu, events: ev } = make();
    let k = 0;
    for (let i = 0; i < 20; i++) queue.push(() => toolUse('tu_' + ++k, 'get_project', {}));
    await ask(tu, 'Endlos', 'a8');
    assert.strictEqual(requests.length, 13);
    const r13 = requests[12].body;
    assert.deepStrictEqual(r13.tool_choice, { type: 'none' });
    const lu = lastUser(r13.messages).content;
    assert.ok(lu[lu.length - 1].type === 'text' && lu[lu.length - 1].text.includes('Schrittlimit'));
    const d = of(ev, 'a8').find((x) => x.type === 'done');
    assert.ok(d && d.limit === true, JSON.stringify(d));
    assert.ok(historyValid(tu.messages));
    // A wrap-up that stops with max_tokens (or pause_turn) still ends the turn: no 14th call.
    reset();
    const { tutor: tu2, events: ev2 } = make();
    for (let i = 0; i < 12; i++) queue.push(() => toolUse('tw_' + ++k, 'get_project', {}));
    queue.push(() => toolUse('tw_' + ++k, 'get_project', {}, { stop: 'max_tokens' }), () => toolUse('tw_' + ++k, 'get_project', {}));
    await ask(tu2, 'Endlos', 'a8b');
    assert.strictEqual(requests.length, 13, 'no call after the wrap-up');
    assert.ok(of(ev2, 'a8b').some((x) => x.type === 'done'));
    assert.ok(historyValid(tu2.messages));
    console.log('  ok   step limit: 12 steps, then one wrap-up call without tools');
  }

  // ---------------------------------------------------------------- 9. max_tokens with tool_use
  {
    reset();
    const { tutor: tu } = make();
    queue.push(toolUse('tu_1', 'write_file', { path: 'Hund.java', content: 'class Hund' }, { stop: 'max_tokens' }), answer('Kleiner.'));
    await ask(tu, 'Schreib alles', 'a9');
    assert.strictEqual(calls.length, 0);
    const r = requests[1].body.messages[2].content[0];
    assert.ok(r.is_error && r.content.includes('max_tokens'));
    console.log('  ok   tool input cut off at max_tokens is not run');
  }

  // ---------------------------------------------------------------- 10. refusal
  {
    reset();
    const { tutor: tu, events: ev } = make();
    const snapshot = JSON.stringify(tu.messages);
    queue.push(message([{ type: 'text', text: 'Ich ...' }, { type: 'tool_use', id: 'tu_1', name: 'compile', input: {} }], 'refusal'));
    await ask(tu, 'Böses', 'a10');
    assert.strictEqual(calls.length, 0);
    const e = of(ev, 'a10');
    assert.ok(e.some((x) => x.type === 'discard' && x.step === 1));
    assert.strictEqual(JSON.stringify(tu.messages), snapshot, 'refused question is taken back');
    assert.strictEqual(e.find((x) => x.type === 'done').stopReason, 'refusal');
    reset();
    queue.push(toolUse('tu_2', 'get_project', {}), message([{ type: 'text', text: 'Nein' }], 'refusal'));
    await ask(tu, 'Erst gut', 'a10b');
    assert.deepStrictEqual(tu.messages.map((x) => x.role), ['user', 'assistant', 'user']);
    assert.ok(historyValid(tu.messages));
    console.log('  ok   refusal: nothing runs, a refused question leaves no trace');
  }

  // ---------------------------------------------------------------- 11. newChat during a tool
  {
    reset();
    const { tutor: tu, events: ev } = make();
    toolImpl = () => new Promise(() => {});
    queue.push(toolUse('tu_1', 'compile', {}));
    const p = ask(tu, 'Kompilier', 'a11');
    await wait(30);
    tu.newChat({ lang: 'de', mode: 'hints' });
    await p;
    await wait(20);
    assert.strictEqual(requests.length, 1);
    assert.ok(!of(ev, 'a11').some((x) => x.type === 'done' || x.type === 'aborted' || x.type === 'error'));
    assert.strictEqual(tu.messages.length, 0);
    assert.strictEqual(tu.busy, false);
    await ask(tu, 'Neu', 'a11b');
    assert.ok(of(ev, 'a11b').some((x) => x.type === 'done'));
    console.log('  ok   new chat while a tool runs: the old turn ends silently, the next one starts');
  }

  // ---------------------------------------------------------------- 12. mid-stream fallback
  {
    reset();
    const { tutor: tu, events: ev } = make();
    queue.push(message([
      { type: 'tool_use', id: 'tu_a', name: 'compile', input: {} },
      { type: 'fallback' },
      { type: 'text', text: 'Weiter mit Sonnet.' },
      { type: 'tool_use', id: 'tu_b', name: 'get_project', input: {} },
    ], 'tool_use'), answer('Fertig.'));
    await ask(tu, 'Los', 'a12');
    assert.deepStrictEqual(calls.map((c) => c.callId), ['tu_b']);
    assert.ok(of(ev, 'a12').some((x) => x.type === 'toolCancel' && x.callIds.includes('tu_a')));
    const a = tu.messages[1].content;
    assert.ok(!a.some((b) => b.id === 'tu_a'));
    assert.ok(a.findIndex((b) => b.type === 'fallback') < a.findIndex((b) => b.type === 'text'));
    assert.ok(historyValid(tu.messages));
    console.log('  ok   mid-stream fallback: calls from the declined attempt never run');
  }

  // ---------------------------------------------------------------- 13. unparseable tool JSON
  {
    reset();
    const { tutor: tu, events: ev } = make();
    queue.push(toolUse('tu_1', 'read_file', null, { raw: '{"path": "Hund.java"' + '}}}' }), answer('Okay.'), answer('Okay.'));
    await ask(tu, 'Lies', 'a13');
    assert.strictEqual(calls.length, 0);
    const e = of(ev, 'a13');
    const reissued = e.some((x) => x.type === 'discard') && requests.length >= 2;
    const answered = tu.messages.some((m) => m.role === 'user' && m.content.some((b) => b.type === 'tool_result' && String(b.content).includes('INVALID_INPUT')));
    assert.ok(reissued || answered, JSON.stringify(e));
    assert.ok(e.some((x) => x.type === 'done'));
    assert.ok(historyValid(tu.messages));
    console.log('  ok   unparseable tool input: ' + (reissued ? 're-issued' : 'answered as invalid'));
  }

  // ---------------------------------------------------------------- 14. tool throws
  {
    reset();
    const { tutor: tu } = make();
    toolImpl = async () => { throw new Error('boom'); };
    queue.push(toolUse('tu_1', 'compile', {}), answer('Hm.'));
    await ask(tu, 'Los', 'a14');
    const r = requests[1].body.messages[2].content[0];
    assert.ok(r.is_error === true && r.content === 'boom');
    console.log('  ok   a tool that throws becomes an error result');
  }

  // ---------------------------------------------------------------- 15. context window
  {
    reset();
    const { tutor: tu, events: ev } = make();
    queue.push(toolUse('tu_1', 'compile', {}, { stop: 'model_context_window_exceeded' }));
    await ask(tu, 'Viel', 'a15');
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(of(ev, 'a15').find((x) => x.type === 'done').full, true);
    assert.ok(historyValid(tu.messages));
    tu.lastContext = 900000;
    await assert.rejects(() => ask(tu, 'Mehr', 'a15b'), (x) => x.code === 'chatFull');
    console.log('  ok   full context: nothing runs, a full chat refuses new messages');
  }

  // ---------------------------------------------------------------- 16. target grammar
  {
    const web = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'tour-targets.mjs')).href);
    const ids = ['compile', 'run-main', 'state', 'class:Hund', 'class:tiere.Hund', 'class-new:Hund', 'package:medien', 'object:bello', 'dock:console',
      'dock:nope', 'problem:1', 'problem:0', 'editor-tab:tiere/Hund.java', 'line:Hund.java:12', 'gutter:Hund.java:3', 'line:../Hund.java:1',
      'side-tab:tutor', 'debug:stepOver', 'rail:settings', 'settings:agentWrite', 'settings:nope', 'menu:new', 'menu:new:2', 'menu:static:max',
      'menu:method:bellen', 'menu:inspect', 'dialog:arg:0', 'dialog:confirm', 'proposal-accept', 'nonsense'];
    for (const id of ids) {
      const a = parseTarget(id);
      const b = web.parseTarget(id);
      assert.deepStrictEqual(a && a.kind, b && b.kind, id);
      assert.deepStrictEqual(a, b, id);
    }
    assert.strictEqual(parseTarget('line:Hund.java:12').arg2, 12);
    assert.strictEqual(parseTarget('dock:nope'), null);
    const desc = TOOLS.find((t) => t.name === 'show_tutorial').description;
    assert.ok(desc.includes('class:<Name>') && desc.includes('menu:new:<i>') && desc.includes('dialog:confirm'));
    console.log('  ok   tutorial targets: the window and the main process share one grammar');
  }

  {
    reset();
    const { tutor: b } = make();
    b.newChat({ lang: 'de', mode: 'build' });
    await b.send({ text: 'Baue Snake', model: MODEL, lang: 'de', mode: 'build', turnId: 'tb', agent: { ...AGENT, mode: 'build' } });
    const rb = requests[0];
    assert.deepStrictEqual(rb.body.output_config, { effort: 'high' });
    assert.strictEqual(rb.body.max_tokens, 64000);
    assert.ok(sys(rb.body).includes('Modus: Bauen') && !sys(rb.body).includes('Modus: Tipps'));
    reset();
    const { tutor: h } = make();
    h.newChat({ lang: 'de', mode: 'build' });
    await h.send({ text: 'Baue Snake', model: 'claude-haiku-5-5', lang: 'de', mode: 'build', turnId: 'th', agent: { ...AGENT, mode: 'build' } });
    assert.deepStrictEqual(requests[0].body.output_config, { effort: 'high' });
    console.log('  ok   build mode: its own prompt, high effort, room for long files');
  }

  {
    // A step that only thinks (cut off by max_tokens) runs again with a push instead of ending silently.
    reset();
    const { tutor: e, events: ev } = make();
    queue.push(message([{ type: 'thinking' }], 'max_tokens'), answer('Hallo zurück'));
    await e.send({ text: 'Hallo', model: MODEL, lang: 'de', mode: 'hints', turnId: 'te', agent: AGENT });
    assert.strictEqual(requests.length, 2);
    const lastQ = requests[1].body.messages[requests[1].body.messages.length - 1];
    assert.ok(lastQ.role === 'user' && lastQ.content.some((b) => b.type === 'text' && b.text.startsWith('Du hast nur nachgedacht')));
    const done = ev.find((x) => x.type === 'done');
    assert.ok(done && !done.empty);
    assert.ok(historyValid(e.messages) && e.messages[e.messages.length - 1].role === 'assistant');
    // Only thinking, again and again: the turn ends and says so.
    reset();
    const { tutor: e2, events: ev2 } = make();
    for (let i = 0; i < 5; i++) queue.push(message([{ type: 'thinking' }], 'max_tokens'));
    await e2.send({ text: 'Hallo', model: MODEL, lang: 'de', mode: 'hints', turnId: 'te2', agent: AGENT });
    assert.strictEqual(requests.length, 3);
    assert.ok(ev2.find((x) => x.type === 'done').empty);
    console.log('  ok   a step that only thinks is retried with a push; endless thinking ends visibly');
  }

  {
    // Build mode: a plan without code, then code without a clean compile, both go back to work.
    reset();
    toolImpl = async (call) => ({ content: call.name === 'compile' ? '{"ok":true,"ms":120}' : '{"status":"applied","file":"Spiel.java"}' });
    const { tutor: b } = make();
    b.newChat({ lang: 'de', mode: 'build' });
    queue.push(
      answer('Plan: eine Klasse Spiel.'),
      toolUse('tu_b1', 'create_class', { name: 'Spiel', content: 'public class Spiel {\n}\n' }),
      answer('Fertig gebaut.'),
      toolUse('tu_b2', 'compile', {}),
      answer('Gebaut und kompiliert.'),
    );
    await b.send({ text: 'Baue ein Spiel', model: MODEL, lang: 'de', mode: 'build', turnId: 'tbn', agent: { ...AGENT, mode: 'build' } });
    assert.strictEqual(requests.length, 5);
    const texts = (i) => requests[i].body.messages[requests[i].body.messages.length - 1].content.map((x) => x.text || '').join('');
    assert.ok(texts(1).startsWith('Es ist noch nichts gebaut'));
    assert.ok(texts(3).startsWith('Seit deiner letzten Änderung'));
    assert.deepStrictEqual(calls.map((c) => c.name), ['create_class', 'compile']);
    assert.ok(historyValid(b.messages));
    console.log('  ok   build mode keeps working until something is built and compiles');
  }

  // ---------------------------------------------------------------- 17. screenshots in tool results
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  {
    reset();
    const { tutor: tu } = make();
    toolImpl = async (call) => (call.name === 'look_at_program'
      ? { content: '{"window":{"title":"Feld","width":320,"height":200}}', images: [{ media_type: 'image/png', data: PNG }, { media_type: 'image/png', data: 'not base64 !!' }, { data: PNG }] }
      : { content: '', images: [{ media_type: 'image/png', data: PNG }] });
    queue.push(message([{ type: 'tool_use', id: 'tu_l', name: 'look_at_program', input: { class: 'Feld', resize_to: { width: 640, height: 400 } } }, { type: 'tool_use', id: 'tu_u', name: 'use_program', input: { steps: [{ do: 'key', key: 'RIGHT' }, { do: 'shot' }] } }], 'tool_use'), answer('Sieht gut aus.'));
    await ask(tu, 'Schau es dir an', 'a17');
    const res = requests[1].body.messages[2].content;
    const look = res[0];
    assert.ok(Array.isArray(look.content) && look.content[0].type === 'text' && look.content[0].text.includes('"title":"Feld"'), JSON.stringify(look).slice(0, 300));
    const imgs = look.content.filter((b) => b.type === 'image');
    assert.strictEqual(imgs.length, 2, 'the broken image is dropped, a missing media type becomes PNG');
    assert.deepStrictEqual(imgs[0].source, { type: 'base64', media_type: 'image/png', data: PNG });
    // A result with only a picture still has a (non-empty) text block first.
    assert.ok(res[1].content[0].type === 'text' && res[1].content[0].text.length > 0 && res[1].content[1].type === 'image');
    assert.ok(historyValid(tu.messages));
    // An error result never carries pictures.
    reset();
    const { tutor: tu2 } = make();
    toolImpl = async () => ({ content: 'No window.', isError: true, images: [{ media_type: 'image/png', data: PNG }] });
    queue.push(toolUse('tu_e', 'look_at_program', {}), answer('Kein Fenster.'));
    await ask(tu2, 'Schau', 'a17b');
    assert.strictEqual(requests[1].body.messages[2].content[0].content, 'No window.');
    console.log('  ok   screenshots go back as image blocks after the text, bad ones are dropped');
  }

  // ---------------------------------------------------------------- 18. the new tools' input rules
  {
    assert.strictEqual(validateToolInput('look_at_program', {}), null);
    assert.strictEqual(validateToolInput('look_at_program', { class: 'Feld', wait_ms: 500, resize_to: { width: 800, height: 600 }, keep_running: true }), null);
    assert.ok(validateToolInput('look_at_program', { class: '../Feld' }));
    assert.ok(validateToolInput('look_at_program', { resize_to: { width: 20, height: 600 } }));
    assert.strictEqual(validateToolInput('use_program', { steps: [{ do: 'key', key: 'SPACE', hold_ms: 200 }, { do: 'click', x: 10, y: 20, button: 3 }, { do: 'wait', ms: 300 }, { do: 'type', text: 'Anna' }, { do: 'resize', width: 600, height: 400 }, { do: 'shot' }] }), null);
    assert.ok(/needs key/.test(validateToolInput('use_program', { steps: [{ do: 'key' }] })));
    assert.ok(/needs y/.test(validateToolInput('use_program', { steps: [{ do: 'click', x: 3 }] })));
    assert.ok(/does not take/.test(validateToolInput('use_program', { steps: [{ do: 'wait', ms: 10, key: 'A' }] })));
    assert.ok(/at most 3 shot/.test(validateToolInput('use_program', { steps: [{ do: 'shot' }, { do: 'shot' }, { do: 'shot' }, { do: 'shot' }] })));
    assert.ok(/at most 20000/.test(validateToolInput('use_program', { steps: Array.from({ length: 5 }, () => ({ do: 'wait', ms: 5000 })) })));
    assert.ok(validateToolInput('use_program', { steps: [] }));
    assert.strictEqual(validateToolInput('update_plan', { items: [{ text: 'A', status: 'done' }, { text: 'B', status: 'in_progress' }, { text: 'C', status: 'pending' }] }), null);
    assert.ok(/only one/.test(validateToolInput('update_plan', { items: [{ text: 'A', status: 'in_progress' }, { text: 'B', status: 'in_progress' }] })));
    assert.ok(validateToolInput('update_plan', { items: [{ text: 'A', status: 'later' }] }));
    // While a tutorial runs: the checklist may change, the program may not start.
    assert.strictEqual(checkPolicy('update_plan', { items: [] }, AGENT, { tour: true }), null);
    assert.ok(checkPolicy('look_at_program', {}, AGENT, { tour: true }));
    // Exercises in hints mode: looking is fine, it writes nothing.
    assert.strictEqual(checkPolicy('look_at_program', {}, { mode: 'hints', exercise: true, testFiles: [] }, { tour: false }), null);
    console.log('  ok   update_plan, look_at_program and use_program: inputs checked, allowed where they fit');
  }

  // ---------------------------------------------------------------- 19. update_plan keeps the turn going
  {
    reset();
    const { tutor: tu, events: ev } = make();
    tu.newChat({ lang: 'de', mode: 'explain' });
    const items = (a, b) => ({ items: [{ text: 'Lesen', status: a }, { text: 'Ändern', status: b }] });
    queue.push(
      toolUse('tu_p1', 'update_plan', items('in_progress', 'pending')),
      answer('Ich habe es gelesen.'),
      toolUse('tu_p2', 'update_plan', items('done', 'done')),
      answer('Fertig.'),
    );
    await tu.send({ text: 'Mach zwei Dinge', model: MODEL, lang: 'de', mode: 'explain', turnId: 'a19', agent: AGENT });
    assert.strictEqual(requests.length, 4);
    const pushed = requests[2].body.messages[requests[2].body.messages.length - 1].content.map((x) => x.text || '').join('');
    assert.ok(pushed.startsWith('Dein Plan hat noch offene Punkte') && pushed.includes('„Lesen“') && pushed.includes('„Ändern“'), pushed);
    assert.deepStrictEqual(calls.map((c) => c.name), ['update_plan', 'update_plan']);
    assert.ok(of(ev, 'a19').some((x) => x.type === 'done'));
    // A checklist that stays open is pushed back only once.
    reset();
    const { tutor: tu2 } = make();
    tu2.newChat({ lang: 'en', mode: 'explain' });
    queue.push(toolUse('tu_p3', 'update_plan', items('in_progress', 'pending')), answer('Stopping here.'), answer('Still stopping.'));
    await tu2.send({ text: 'Do two things', model: MODEL, lang: 'en', mode: 'explain', turnId: 'a19b', agent: AGENT });
    assert.strictEqual(requests.length, 3);
    assert.ok(requests[2].body.messages[requests[2].body.messages.length - 1].content[0].text.startsWith('Your checklist still has open items: "Lesen"'));
    // Hints mode never pushes.
    reset();
    const { tutor: tu3 } = make();
    queue.push(toolUse('tu_p4', 'update_plan', items('in_progress', 'pending')), answer('Tipp: schau in Zeile 3.'));
    await ask(tu3, 'Hilf mir', 'a19c');
    assert.strictEqual(requests.length, 2);
    console.log('  ok   update_plan: open items send the turn back once (not in hints mode)');
  }

  // ---------------------------------------------------------------- 20. build mode looks at its window
  {
    reset();
    const gui = 'import javax.swing.*;\npublic class Feld extends JPanel {\n}\n';
    toolImpl = async (call) => {
      if (call.name === 'compile') return { content: '{"ok":true,"ms":90}' };
      if (call.name === 'look_at_program') return { content: '{"window":{"title":"Feld"}}', images: [{ media_type: 'image/png', data: PNG }] };
      return { content: '{"status":"applied","file":"Feld.java"}' };
    };
    const { tutor: b } = make();
    b.newChat({ lang: 'de', mode: 'build' });
    queue.push(
      toolUse('tu_g1', 'create_class', { name: 'Feld', content: gui }),
      toolUse('tu_g2', 'compile', {}),
      answer('Fertig gebaut.'),
      toolUse('tu_g3', 'look_at_program', { class: 'Feld' }),
      answer('Angesehen, alles gut.'),
    );
    await b.send({ text: 'Baue ein Fenster', model: MODEL, lang: 'de', mode: 'build', turnId: 'a20', agent: { ...AGENT, mode: 'build' } });
    assert.strictEqual(requests.length, 5);
    const last = (i) => requests[i].body.messages[requests[i].body.messages.length - 1].content.map((x) => x.text || '').join('');
    assert.ok(last(3).startsWith('Das Programm hat ein Fenster'), last(3));
    assert.deepStrictEqual(calls.map((c) => c.name), ['create_class', 'compile', 'look_at_program']);
    // An edit after looking means looking again: the push comes only once per turn, though.
    reset();
    toolImpl = async (call) => (call.name === 'compile' ? { content: '{"ok":true}' } : call.name === 'look_at_program' ? { content: '{}', images: [{ data: PNG }] } : { content: '{"status":"applied","gui":true}' });
    const { tutor: b2 } = make();
    b2.newChat({ lang: 'de', mode: 'build' });
    queue.push(
      toolUse('tu_h1', 'edit_file', { path: 'Spiel.java', old_text: 'a', new_text: 'b' }),
      toolUse('tu_h2', 'compile', {}),
      answer('Fertig.'),
      answer('Wirklich fertig.'),
    );
    await b2.send({ text: 'Mach es schneller', model: MODEL, lang: 'de', mode: 'build', turnId: 'a20b', agent: { ...AGENT, mode: 'build' } });
    assert.strictEqual(requests.length, 4, 'the window flag from the write result counts; one push only');
    assert.ok(historyValid(b2.messages));
    console.log('  ok   build mode: a window program is looked at before the turn ends');
  }

  // ---------------------------------------------------------------- 21. a resumed build remembers what it built
  {
    reset();
    toolImpl = async (call) => ({ content: call.name === 'compile' ? '{"ok":true}' : '{"status":"applied","file":"Spiel.java"}' });
    const { tutor: b, events: ev } = make();
    b.newChat({ lang: 'de', mode: 'build' });
    queue.push(toolUse('tu_r1', 'create_class', { name: 'Spiel', content: 'public class Spiel {\n}\n' }), toolUse('tu_r2', 'compile', {}), { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } });
    // The SDK retries 529 twice by itself: three failures surface the error.
    queue.push({ status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } });
    await b.send({ text: 'Baue ein Spiel', model: MODEL, lang: 'de', mode: 'build', turnId: 'a21', agent: { ...AGENT, mode: 'build' } });
    const err = of(ev, 'a21').find((x) => x.type === 'error');
    assert.ok(err && err.partial === true && ['server', 'overloaded'].includes(err.code), JSON.stringify(err));
    const n = requests.length;
    queue.push(answer('Fertig gebaut.'));
    await b.continue({ turnId: 'a21', model: MODEL, agent: { ...AGENT, mode: 'build' }, stepBase: 3 });
    assert.strictEqual(requests.length, n + 1, 'no "nothing is built yet" push after resuming');
    assert.ok(of(ev, 'a21').some((x) => x.type === 'done'));
    assert.ok(historyValid(b.messages));
    console.log('  ok   a resumed turn keeps what it did (no false push back to work)');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nall AI checks passed');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
