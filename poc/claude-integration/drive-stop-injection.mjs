// PoC driver: plays the "phone".
// 1. Waits for a new session to appear at the broker.
// 2. Denies its first permission request.
// 3. Queues a follow-up instruction (delivered through the Stop hook).
// 4. Approves the permission request the follow-up triggers.
const B = 'http://127.0.0.1:47821';
const get = async (p) => (await fetch(B + p)).json();
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const known = new Set(Object.keys((await get('/state')).sessions));
let sid;
while (!sid) {
  await sleep(500);
  sid = Object.keys((await get('/state')).sessions).find((s) => !known.has(s));
}
console.log('session', sid);

const decided = new Set();
async function nextPending() {
  for (;;) {
    const a = (await get('/state')).approvals.find((x) => x.session_id === sid && x.status === 'pending' && !decided.has(x.id));
    if (a) { decided.add(a.id); return a; }
    await sleep(500);
  }
}

const a1 = await nextPending();
console.log('deny', a1.tool_name, JSON.stringify(a1.tool_input.command), await post(`/approvals/${a1.id}`, { decision: 'deny', message: 'Not this one - wait for my next instruction.' }));
console.log('queue', await post(`/sessions/${sid}/instructions`, { text: 'Instead, run exactly: echo second-instruction > second.txt' }));
const a2 = await nextPending();
console.log('allow', a2.tool_name, JSON.stringify(a2.tool_input.command), await post(`/approvals/${a2.id}`, { decision: 'allow' }));
