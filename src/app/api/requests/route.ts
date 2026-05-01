import { requireUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const approvals = await prisma.approvalRequest.findMany({
      where: { userId: user.id },
      include: { task: { include: { agent: true } } },
      orderBy: { createdAt: "desc" },
    });

    return ok({ approvals });
  } catch (error) {
    return fail(error);
  }
}
