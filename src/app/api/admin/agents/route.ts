import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

const createSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  description: z.string().min(1).max(2000),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const agents = await prisma.agent.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { users: true, conversations: true, tasks: true } } },
    });
    return ok({ agents });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = createSchema.parse(await request.json());
    const agent = await prisma.agent.create({ data: body });
    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.agent.created",
      summary: `Admin ${admin.email} created agent ${agent.slug}.`,
      metadata: { agentId: agent.id },
    });
    return ok({ agent });
  } catch (error) {
    return fail(error);
  }
}
