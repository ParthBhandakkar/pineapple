import { z } from "zod";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const profileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = profileSchema.parse(await request.json());

    const data: Record<string, unknown> = {};

    if (body.name && body.name.trim() && body.name !== user.name) {
      data.name = body.name.trim();
    }

    if (body.newPassword) {
      if (!body.currentPassword) {
        throw new HttpError(400, "Provide your current password to change it.");
      }
      const verified = await verifyPassword(body.currentPassword, user.passwordHash);
      if (!verified) {
        throw new HttpError(401, "Current password is incorrect.");
      }
      data.passwordHash = await hashPassword(body.newPassword);
    }

    if (Object.keys(data).length === 0) {
      return ok({ user });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return ok({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
