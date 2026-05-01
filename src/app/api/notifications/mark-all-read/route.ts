import { requireUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const user = await requireUser();
    const now = new Date();
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: now },
    });
    return ok({ updated: result.count });
  } catch (error) {
    return fail(error);
  }
}
