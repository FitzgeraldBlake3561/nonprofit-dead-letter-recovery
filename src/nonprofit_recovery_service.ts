import { createServer, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai_queue.js";
import { decideRecovery, failedJobSchema } from "./recovery_policy.js";

const queue = process.env.INFRAI_QUEUE ?? "nonprofit-jobs";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/dead-letters") {
      return json(response, 200, await infrai.queue.dlq.list(queue));
    }

    if (request.method !== "POST" || request.url !== "/recover") {
      return json(response, 404, { error: "Route not found" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const job = failedJobSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const decision = decideRecovery(job, new Date());

    if (decision.action === "manual_review") {
      return json(response, 202, { messageId: job.messageId, ...decision });
    }

    const idempotencyKey = createHash("sha256")
      .update(`${queue}:${job.messageId}:redrive`)
      .digest("hex");
    await infrai.queue.dlq.redrive(queue, job.messageId, idempotencyKey);
    return json(response, 200, { messageId: job.messageId, ...decision });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return json(response, 400, { error: "Invalid recovery request" });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.code, message: error.message });
    }
    console.error(error);
    return json(response, 500, { error: "Recovery request failed" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Nonprofit recovery service listening on ${port}`));
}
