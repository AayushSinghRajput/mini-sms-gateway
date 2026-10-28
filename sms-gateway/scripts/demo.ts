/**
 * One-command end-to-end demo against a local or deployed Mini SMS Gateway.
 * Run as: BASE_URL=https://<app>.vercel.app npm run demo
 *
 * Uses only fetch (no direct DB access) so it works against any deployment with DEMO_CONTROLS=true.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log(`Running demo against ${BASE} ...\n`);
  let token: string | undefined;

  try {
    // 1. Register fresh user and read starting balance
    const email = `demo-${Date.now()}@example.com`;
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "password123" }),
    });
    assert(reg.status === 201, `register failed (${reg.status}): ${JSON.stringify(reg.body)}`);
    token = reg.body.token;

    const w1 = await api("/api/wallet", { token });
    assert(w1.status === 200, `wallet fetch failed (${w1.status})`);
    const startBalance = w1.body.balance;
    console.log(`1. Registered ${email} (starting balance: ${startBalance})`);

    // Check demo controls endpoint
    const set0 = await api("/api/demo/routes", {
      method: "POST",
      token,
      body: JSON.stringify({ name: "all", failureRate: 0 }),
    });
    if (set0.status === 404) {
      console.error("\nServer returned 404 on /api/demo/routes. Ensure DEMO_CONTROLS=true is set on the server.");
      process.exit(1);
    }
    assert(set0.status === 200, `setting routes to 0 failed (${set0.status}): ${JSON.stringify(set0.body)}`);

    // 2. Send SMS to two numbers with failureRate 0
    const send2 = await api("/api/sms/send", {
      method: "POST",
      token,
      body: JSON.stringify({ to: ["9841234567", "+9779801122334"], message: "Hello from demo" }),
    });
    assert(send2.status === 200, `send failed (${send2.status}): ${JSON.stringify(send2.body)}`);
    assert(send2.body.results?.length === 2, "expected 2 results");
    assert(send2.body.results.every((r: { status: string }) => r.status === "SENT"), "expected all results to be SENT");
    const w2 = await api("/api/wallet", { token });
    assert(w2.body.balance === startBalance - 2, `expected balance ${startBalance - 2}, got ${w2.body.balance}`);
    console.log(`2. Sent to 2 numbers (0% failure) -> both SENT, balance dropped by 2 (${w2.body.balance})`);

    // 3. Send 100 Nepali characters
    const nepaliMsg = "न".repeat(100);
    const sendNep = await api("/api/sms/send", {
      method: "POST",
      token,
      body: JSON.stringify({ to: ["9841234567"], message: nepaliMsg }),
    });
    assert(sendNep.status === 200, `nepali send failed (${sendNep.status}): ${JSON.stringify(sendNep.body)}`);
    assert(sendNep.body.encoding === "UNICODE", `expected UNICODE, got ${sendNep.body.encoding}`);
    assert(sendNep.body.partsPerMessage === 2, `expected 2 parts, got ${sendNep.body.partsPerMessage}`);
    assert(sendNep.body.totalCost === 2, `expected totalCost 2, got ${sendNep.body.totalCost}`);
    console.log(`3. Sent 100 Nepali chars -> encoding=${sendNep.body.encoding}, parts=${sendNep.body.partsPerMessage}, cost=${sendNep.body.totalCost}`);

    // 4. Send to invalid number
    const wBefore4 = (await api("/api/wallet", { token })).body.balance;
    const sendInv = await api("/api/sms/send", {
      method: "POST",
      token,
      body: JSON.stringify({ to: ["9612345678"], message: "test" }),
    });
    assert(sendInv.status === 400, `expected 400, got ${sendInv.status}`);
    assert(sendInv.body?.error?.code === "INVALID_NUMBERS", `expected INVALID_NUMBERS, got ${sendInv.body?.error?.code}`);
    const wAfter4 = (await api("/api/wallet", { token })).body.balance;
    assert(wAfter4 === wBefore4, `balance changed from ${wBefore4} to ${wAfter4}`);
    console.log(`4. Invalid number 9612345678 -> rejected 400 INVALID_NUMBERS, balance unchanged (${wAfter4})`);

    // 5. Failover: ROUTE_A fails, ROUTE_B & ROUTE_C 0
    await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_A", failureRate: 1 }) });
    await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_B", failureRate: 0 }) });
    await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_C", failureRate: 0 }) });

    const sendFo = await api("/api/sms/send", {
      method: "POST",
      token,
      body: JSON.stringify({ to: ["9841234567"], message: "Failover test" }),
    });
    assert(sendFo.status === 200, `failover send failed (${sendFo.status}): ${JSON.stringify(sendFo.body)}`);
    const resFo = sendFo.body.results?.[0];
    assert(resFo?.provider === "ROUTE_B", `expected provider ROUTE_B, got ${resFo?.provider}`);
    assert(resFo?.attempts?.[0] === "ROUTE_A:failed", `expected attempts[0] ROUTE_A:failed, got ${resFo?.attempts?.[0]}`);
    console.log(`5. Failover: ROUTE_A failed -> delivered via ROUTE_B (${resFo.attempts.join(" -> ")})`);

    // 6. Refund: all routes fail
    const balBeforeRefund = (await api("/api/wallet", { token })).body.balance;
    await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "all", failureRate: 1 }) });

    const sendRef = await api("/api/sms/send", {
      method: "POST",
      token,
      body: JSON.stringify({ to: ["9841234567"], message: "Refund test" }),
    });
    assert(sendRef.status === 200, `refund send failed (${sendRef.status}): ${JSON.stringify(sendRef.body)}`);
    const resRef = sendRef.body.results?.[0];
    assert(resRef?.status === "FAILED", `expected status FAILED, got ${resRef?.status}`);
    assert(resRef?.refunded === true, "expected refunded to be true");
    const balAfterRefund = (await api("/api/wallet", { token })).body.balance;
    assert(balAfterRefund === balBeforeRefund, `expected restored balance ${balBeforeRefund}, got ${balAfterRefund}`);
    console.log(`6. Refund: all routes failed -> status=FAILED, refunded=true, balance restored (${balAfterRefund})`);
  } catch (err) {
    console.error("\nFAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    // 7. Restore original seed failure rates
    if (token) {
      await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_A", failureRate: 0.3 }) });
      await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_B", failureRate: 0.1 }) });
      await api("/api/demo/routes", { method: "POST", token, body: JSON.stringify({ name: "ROUTE_C", failureRate: 0.05 }) });
      console.log("7. Restored original failure rates (ROUTE_A: 0.3, ROUTE_B: 0.1, ROUTE_C: 0.05)");
    }
  }

  // 8. Logs & route health
  const logs = await api("/api/sms/logs?status=failed&limit=5", { token });
  assert(logs.status === 200, `logs fetch failed (${logs.status})`);
  const health = await api("/api/routes/health", { token });
  assert(health.status === 200, `health fetch failed (${health.status})`);

  console.log(`8. Checked logs & health: ${logs.body.data?.length ?? 0} failed message(s) retrieved`);
  for (const r of health.body.routes ?? []) {
    console.log(`   - ${r.name} (prio ${r.priority}): health=${r.healthPercent}% [${r.label}], failureRate=${r.failureRate}`);
  }

  console.log("\nPASS: All demo steps completed successfully.");
}

main();
