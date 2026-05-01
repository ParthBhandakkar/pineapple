import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().min(1).max(60).optional(),
  description: z.string().min(1).max(2000).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: { _count: { select: { users: true, conversations: true, tasks: true } } },
    });
    if (!agent) throw new HttpError(404, "Agent not found");
    return ok({ agent });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    const agent = await prisma.agent.update({ where: { id }, data: body });

    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.agent.updated",
      summary: `Admin ${admin.email} updated agent ${agent.slug}.`,
      metadata: { agentId: agent.id, changes: body },
    });

    return ok({ agent });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new HttpError(404, "Agent not found");
    await prisma.agent.delete({ where: { id } });
    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.agent.deleted",
      summary: `Admin ${admin.email} deleted agent ${agent.slug}.`,
      metadata: { agentId: id },
    });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
