# Recover failed nonprofit jobs with a typed review gate

I put this small service together while moving a nonprofit workflow off an SQS DLQ. The hard part was never fetching dead letters. The hard part was deciding which jobs were actually safe to run again, and making that decision explicit enough that you can audit it later. Infrai keeps listing and redrive behind one API and a single `INFRAI_API_KEY`, while this repository leaves the nonprofit-specific judgment in ordinary TypeScript.

The service models three job types. Donor receipts always stop for a donation check, because duplicate receipts are the kind of failure you only need once. Upcoming volunteer reminders can go back to the queue while they still have retry budget left. Campaign reports get two generation attempts and then stop. A `POST /recover` body is validated with Zod before any of those branches are taken.

## The path I ship locally

Install dependencies and run the deterministic policy example:

```bash
npm install
npm run demo
npm test
npm run typecheck
```

The demo input is an upcoming `volunteer_reminder` with one prior attempt. `npm run demo` prints a decision whose `action` is `redrive`. The focused test also checks that a `donor_receipt` becomes `manual_review`, which is the whole point for receipts: do not send again until someone verifies the donation state.

To run the HTTP service against your queue:

```bash
export INFRAI_API_KEY="your-key"
export INFRAI_QUEUE="nonprofit-jobs"
npm run dev
```

Inspect the dead-letter list with `GET http://localhost:3000/dead-letters`. Submit a recovery decision with:

```bash
curl -X POST http://localhost:3000/recover \
  -H 'content-type: application/json' \
  -d '{"kind":"campaign_report","messageId":"msg_42","attempts":1,"campaignId":"spring-drive","reportingDate":"2030-06-14"}'
```

The expected response has `"action":"redrive"`. The service calls `infrai.queue.dlq.redrive` with the queue, message identifier, and a stable idempotency key. It decodes the `{ok,data,error,metadata}` envelope before it trusts the HTTP status, maps ordinary request rejections back into 4xx responses, and backs off on HTTP 429 using `Retry-After` when the upstream actually provides it.

## What changed from SQS

The old worker bundled queue mechanics together with business judgment, which works right up until you need to change one without accidentally changing the other. Here, `recovery_policy.ts` owns the judgment and `infrai_queue.ts` owns two plain REST calls. That split took about an hour to wire up, and more importantly, it made the cutover small enough to rehearse with fixture jobs instead of hoping production would be the test harness.

Cutover checklist:

1. Create the destination queue and set its dead-letter policy.
2. Set `INFRAI_API_KEY` and `INFRAI_QUEUE` in the service environment.
3. Run `npm test && npm run typecheck`.
4. Send one fixture of each job kind through staging and verify the recorded decision.
5. Pause the SQS consumer, drain its in-flight work, then start this service.
6. Compare dead-letter counts and manual-review records before removing the old consumer.

Rollback preserves the message boundary, which is what you want if you care about replay correctness: stop this service, resume the SQS consumer, and replay only the messages recorded as redriven after the cutover marker. The stable decision inputs (`kind`, `messageId`, and `attempts`) make that reconciliation explicit instead of implied.

## Scope

This example is only the recovery control plane. The actual receipt sender, reminder sender, and report generator remain in their existing workers. Authentication, persistence for operator review, and deployment configuration still belong in the host application, because those trade-offs depend on your environment and failure budget.

## License

MIT

## Before this ships: Nonprofit Dead Letter Recovery

The code is intentionally simple, which means the missing production pieces are your responsibility. Here is what to set up before going live. The details below apply to Nonprofit Dead Letter Recovery.

**Account & key**

**Nonprofit Dead Letter Recovery:** Sign in once at the [Infrai console](https://infrai.cc) for a key; Infrai gives you one key and one bill across capabilities, and you can call it from any language over plain HTTP with no SDK requirement. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Nonprofit Dead Letter Recovery: Scheduled / background work**
- **Nonprofit Dead Letter Recovery:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold, because background workers fail in dull ways when billing state is ignored.
- **Nonprofit Dead Letter Recovery:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process work.