import { z } from "zod";

export const failedJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("donor_receipt"),
    messageId: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    donorId: z.string().min(1),
    donationId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("volunteer_reminder"),
    messageId: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    volunteerId: z.string().min(1),
    shiftStartsAt: z.string().datetime()
  }),
  z.object({
    kind: z.literal("campaign_report"),
    messageId: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    campaignId: z.string().min(1),
    reportingDate: z.string().date()
  })
]);

export type FailedJob = z.infer<typeof failedJobSchema>;

export type RecoveryDecision =
  | { action: "redrive"; reason: string }
  | { action: "manual_review"; reason: string };

export function decideRecovery(job: FailedJob, now: Date): RecoveryDecision {
  if (job.kind === "donor_receipt") {
    return {
      action: "manual_review",
      reason: "Receipt delivery needs a donation check before another donor email."
    };
  }

  if (job.kind === "volunteer_reminder") {
    const shiftIsFuture = new Date(job.shiftStartsAt).getTime() > now.getTime();
    return shiftIsFuture && job.attempts < 3
      ? { action: "redrive", reason: "The shift is upcoming and the retry budget remains." }
      : { action: "manual_review", reason: "The reminder is stale or its retry budget is spent." };
  }

  return job.attempts < 2
    ? { action: "redrive", reason: "Campaign reports can be regenerated within two attempts." }
    : { action: "manual_review", reason: "Repeated report generation needs an operator check." };
}
