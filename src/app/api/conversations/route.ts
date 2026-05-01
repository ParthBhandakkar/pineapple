import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createOpenCodeSession } from "@/lib/opencode";
import { logError } from "@/lib/error-logger";

const createConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  agentId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = createConversationSchema.parse(await request.json());
    const selectedAgent = body.agentId
      ? await prisma.userAgent.findFirst({
          where: { userId: user.id, agentId: body.agentId, status: "DEPLOYED" },
          select: { agentId: true },
        })
      : null;

    if (body.agentId && !selectedAgent) {
      throw new HttpError(403, "This agent is not deployed for your account");
    }

    const openCodeSession = await createOpenCodeSession().catch((error) => {
      logError("OpenCode session bootstrap failed", error, {
        userId: user?.id,
      });
      return null;
    });

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        agentId: selectedAgent?.agentId,
        title: body.title ?? "New OpenCode session",
        opencodeSessionId: openCodeSession?.id,
      },
      include: { agent: true, messages: true },
    });

    return ok({ conversation });
  } catch (error) {
    return fail(error);
  }
}
