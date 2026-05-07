import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const readSchema = z.object({
  path: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = readSchema.parse(await request.json());

    const file = await prisma.userFile.findUnique({
      where: { userId_path: { userId: user.id, path: body.path } },
    });

    if (!file) throw new HttpError(404, "File not found in workspace");

    return ok({
      file: {
        id: file.id,
        path: file.path,
        content: file.content,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        updatedAt: file.updatedAt,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
