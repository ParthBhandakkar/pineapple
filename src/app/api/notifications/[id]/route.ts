import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true, readAt: true },
    });
    if (!existing) {
      throw new HttpError(404, "Notification not found");
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return ok({ notification: updated });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError(404, "Notification not found");
    }

    await prisma.notification.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
