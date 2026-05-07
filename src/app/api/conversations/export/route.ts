import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
} from "docx";

const exportSchema = z.object({
  conversationId: z.string().optional(),
  format: z.enum(["docx", "pdf"]).default("docx"),
});

function parseCodeBlocks(content: string): Array<{ type: "text" | "code"; lang?: string; value: string }> {
  const parts: Array<{ type: "text" | "code"; lang?: string; value: string }> = [];
  const codeBlockRegex = /```(\w+)?\s*\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", lang: match[1] || "code", value: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return parts;
}

function buildDocxParagraphs(role: string, content: string, timestamp: Date): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${role === "USER" ? "You" : "Assistant"} — ${timestamp.toLocaleString()}`,
          bold: true,
          size: 22,
          color: role === "USER" ? "2563eb" : "16a34a",
        }),
      ],
      spacing: { before: 300, after: 100 },
    })
  );

  const parts = parseCodeBlocks(content);
  for (const part of parts) {
    if (part.type === "code") {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${part.lang ?? "code"}]`, italics: true, size: 18, color: "666666" }),
          ],
          spacing: { before: 100 },
        })
      );
      for (const line of part.value.split("\n")) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: line, font: "Courier New", size: 18 }),
            ],
            indent: { left: 360 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 2, color: "cccccc" },
            },
          })
        );
      }
    } else {
      for (const line of part.value.split("\n")) {
        if (line.trim()) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 20 })],
            })
          );
        }
      }
    }
  }

  return paragraphs;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = exportSchema.parse(await request.json());

    if (body.conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: { id: body.conversationId, userId: user.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });

      if (!conversation) throw new HttpError(404, "Conversation not found");

      const doc = buildDocument(conversation.title, conversation.messages);
      const buffer = await Packer.toBuffer(doc);

      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(conversation.title)}.docx"`,
        },
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });

    if (conversations.length === 0) throw new HttpError(404, "No conversations found");

    const allParagraphs: Paragraph[] = [];
    for (const conv of conversations) {
      allParagraphs.push(
        new Paragraph({
          text: conv.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      );
      for (const msg of conv.messages) {
        allParagraphs.push(...buildDocxParagraphs(msg.role, msg.content, msg.createdAt));
      }
    }

    const doc = new Document({
      sections: [{ children: allParagraphs }],
    });

    const buffer = await Packer.toBuffer(doc);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="all-conversations.docx"`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

function buildDocument(title: string, messages: Array<{ role: string; content: string; createdAt: Date }>) {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    }),
  ];

  for (const msg of messages) {
    paragraphs.push(...buildDocxParagraphs(msg.role, msg.content, msg.createdAt));
  }

  return new Document({
    sections: [{ children: paragraphs }],
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").slice(0, 60) || "conversation";
}
