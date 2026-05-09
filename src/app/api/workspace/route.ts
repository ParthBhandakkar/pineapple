import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_FILES_PER_USER = 200;
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

const createFileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(MAX_FILE_SIZE),
  mimeType: z.string().max(100).optional(),
});

const updateFileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(MAX_FILE_SIZE).optional(),
  newPath: z.string().min(1).max(500).optional(),
});

const deleteFileSchema = z.object({
  path: z.string().min(1).max(500),
});

export async function GET() {
  try {
    const user = await requireUser();

    const files = await prisma.userFile.findMany({
      where: { userId: user.id },
      select: { id: true, path: true, mimeType: true, sizeBytes: true, updatedAt: true },
      orderBy: { path: "asc" },
    });

    return ok({ files });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = createFileSchema.parse(await request.json());
    const path = normalizeWorkspacePath(body.path);

    const fileCount = await prisma.userFile.count({ where: { userId: user.id } });
    if (fileCount >= MAX_FILES_PER_USER) {
      throw new HttpError(400, `Maximum file limit reached (${MAX_FILES_PER_USER}). Delete some files first.`);
    }

    const existing = await prisma.userFile.findUnique({
      where: { userId_path: { userId: user.id, path } },
    });

    if (existing) {
      const updated = await prisma.userFile.update({
        where: { id: existing.id },
        data: {
          content: body.content,
          mimeType: body.mimeType ?? existing.mimeType,
          sizeBytes: Buffer.byteLength(body.content, "utf-8"),
        },
      });
      return ok({ file: { id: updated.id, path: updated.path, sizeBytes: updated.sizeBytes } });
    }

    const file = await prisma.userFile.create({
      data: {
        userId: user.id,
        path,
        content: body.content,
        mimeType: body.mimeType ?? "text/plain",
        sizeBytes: Buffer.byteLength(body.content, "utf-8"),
      },
    });

    return ok({ file: { id: file.id, path: file.path, sizeBytes: file.sizeBytes } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = updateFileSchema.parse(await request.json());
    const path = normalizeWorkspacePath(body.path);
    const nextPath = body.newPath ? normalizeWorkspacePath(body.newPath) : null;

    const file = await prisma.userFile.findUnique({
      where: { userId_path: { userId: user.id, path } },
    });

    if (!file) throw new HttpError(404, "File not found");

    const data: Record<string, unknown> = {};
    if (body.content !== undefined) {
      data.content = body.content;
      data.sizeBytes = Buffer.byteLength(body.content, "utf-8");
    }
    if (body.newPath && nextPath) {
      if (nextPath !== path) {
        const existingTarget = await prisma.userFile.findUnique({
          where: { userId_path: { userId: user.id, path: nextPath } },
        });
        if (existingTarget) {
          throw new HttpError(409, "A file already exists at the new path.");
        }
      }
      data.path = nextPath;
    }

    const updated = await prisma.userFile.update({
      where: { id: file.id },
      data,
    });

    return ok({ file: { id: updated.id, path: updated.path, sizeBytes: updated.sizeBytes } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const body = deleteFileSchema.parse(await request.json());
    const path = normalizeWorkspacePath(body.path);

    const file = await prisma.userFile.findUnique({
      where: { userId_path: { userId: user.id, path } },
    });

    if (!file) throw new HttpError(404, "File not found");

    await prisma.userFile.delete({ where: { id: file.id } });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
