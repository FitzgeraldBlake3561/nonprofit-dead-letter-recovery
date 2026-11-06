import assert from "node:assert/strict";
import test from "node:test";
import { decideRecovery, failedJobSchema } from "../src/recovery_policy.js";

test("keeps donor receipts out of automatic redrive", () => {
  const job = failedJobSchema.parse({
    kind: "donor_receipt",
    messageId: "msg_receipt_17",
    attempts: 1,
    donorId: "donor_8",
    donationId: "gift_99"
  });

  assert.deepEqual(decideRecovery(job, new Date("2030-06-14T09:00:00.000Z")), {
    action: "manual_review",
    reason: "Receipt delivery needs a donation check before another donor email."
  });
});

test("redrives an upcoming volunteer reminder with attempts left", () => {
  const job = failedJobSchema.parse({
    kind: "volunteer_reminder",
    messageId: "msg_shift_21",
    attempts: 2,
    volunteerId: "vol_4",
    shiftStartsAt: "2030-06-15T09:00:00.000Z"
  });

  assert.equal(
    decideRecovery(job, new Date("2030-06-14T09:00:00.000Z")).action,
    "redrive"
  );
});
