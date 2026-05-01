import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const patchSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  name: z.string().min(1).max(120).optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        wallet: true,
        subscriptions: {
          orderBy: { currentPeriodEnd: "desc" },
          take: 5,
          include: { plan: true },
        },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        agents: {
          include: { agent: true },
          take: 50,
        },
        _count: {
          select: {
            tasks: true,
            conversations: true,
            messages: true,
            transactions: true,
            notifications: true,
          },
        },
      },
    });

    if (!user) throw new HttpError(404, "User not found");

    const recentLogs = await prisma.systemLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return ok({ user, logs: recentLogs });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    if (id === admin.id && body.status === "SUSPENDED") {
      throw new HttpError(400, "You cannot suspend your own admin account.");
    }
    if (id === admin.id && body.role === "USER") {
      throw new HttpError(400, "You cannot demote your own admin account.");
    }

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.user.updated",
      summary: `Admin ${admin.email} updated user ${user.email}.`,
      metadata: { changes: body },
    });

    return ok({ user });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    if (id === admin.id) {
      throw new HttpError(400, "You cannot delete your own account.");
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    if (!target) throw new HttpError(404, "User not found");

    await prisma.user.delete({ where: { id } });

    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.user.deleted",
      summary: `Admin ${admin.email} deleted user ${target.email}.`,
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
