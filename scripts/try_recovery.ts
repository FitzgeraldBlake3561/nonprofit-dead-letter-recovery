import { decideRecovery, failedJobSchema } from "../src/recovery_policy.js";

const job = failedJobSchema.parse({
  kind: "volunteer_reminder",
  messageId: "msg_demo_42",
  attempts: 1,
  volunteerId: "vol_104",
  shiftStartsAt: "2030-06-15T09:00:00.000Z"
});

console.log({ job, decision: decideRecovery(job, new Date("2030-06-14T09:00:00.000Z")) });
