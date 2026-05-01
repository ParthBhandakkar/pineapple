import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  userId: z.string().optional(),
  level: z.enum(["ALL", "INFO", "WARN", "ERROR", "AUDIT"]).optional(),
  event: z.string().optional(),
  search: z.string().optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const params = querySchema.parse({
      userId: url.searchParams.get("userId") ?? undefined,
      level: url.searchParams.get("level") ?? undefined,
      event: url.searchParams.get("event") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
    });

    const where: Record<string, unknown> = {};
    if (params.userId) where.userId = params.userId;
    if (params.level && params.level !== "ALL") where.level = params.level;
    if (params.event) where.event = { contains: params.event, mode: "insensitive" };
    if (params.search) {
      where.OR = [
        { summary: { contains: params.search, mode: "insensitive" } },
        { event: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const logs = await prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.take ?? 200,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Group counts per user, useful for the "by user" sidebar.
    const perUser = await prisma.systemLog.groupBy({
      by: ["userId"],
      _count: { _all: true },
    });

    const userIds = perUser.map((p) => p.userId).filter((id): id is string => Boolean(id));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];

    const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
    const summaries = perUser
      .filter((p) => p.userId && usersById[p.userId])
      .map((p) => ({
        user: usersById[p.userId as string],
        count: p._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return ok({ logs, summaries });
  } catch (error) {
    return fail(error);
  }
}
