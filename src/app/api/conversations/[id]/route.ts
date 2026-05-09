import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  title: z.string().min(1).max(120),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeConversationMessages(conversation: { messages: { id: string; userId: string; conversationId: string; role: string; content: string; tokenEstimate: number; modelUsed: string | null; createdAt: Date; }[] }) {
  return {
    ...conversation,
    messages: [...conversation.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
      include: { agent: true, messages: { orderBy: { createdAt: "desc" }, take: 200 } },
    });

    if (!conversation) {
      throw new HttpError(404, "Conversation not found");
    }

    return ok({
      conversation: normalizeConversationMessages(conversation),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const json = patchSchema.parse(await request.json());
    const title = json.title.trim();
    if (!title) {
      throw new HttpError(400, "Title cannot be empty");
    }

    const existing = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError(404, "Conversation not found");
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { title },
      include: { agent: true, messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    });

    return ok({ conversation });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError(404, "Conversation not found");
    }

    await prisma.conversation.delete({
      where: { id },
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
