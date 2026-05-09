import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const MAX_WORKSPACE_PATH_LENGTH = 500;

function normalizeWorkspacePath(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "File path cannot be empty.");

  const normalized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");

  if (normalized.length > MAX_WORKSPACE_PATH_LENGTH) {
    throw new HttpError(400, `File path exceeds maximum length of ${MAX_WORKSPACE_PATH_LENGTH} characters.`);
  }
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new HttpError(400, "Invalid file path.");
  }

  return normalized;
}

const readSchema = z.object({
  path: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = readSchema.parse(await request.json());
    const path = normalizeWorkspacePath(body.path);

    const file = await prisma.userFile.findUnique({
      where: { userId_path: { userId: user.id, path } },
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
