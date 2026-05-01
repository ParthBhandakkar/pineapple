import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logError } from "@/lib/error-logger";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(error: unknown) {
  if (error instanceof HttpError) {
    logError(`HttpError ${error.status}`, error);
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (
    error instanceof Error &&
    /Authentication failed against database server|Invalid `.*\\.findUnique` invocation|Database credentials/i.test(error.message)
  ) {
    logError("Database connectivity error", error);
    return NextResponse.json(
      {
        error:
          "Database connection failed. Please check DATABASE_URL in your environment file and ensure PostgreSQL credentials are valid.",
      },
      { status: 503 },
    );
  }

  if (error instanceof ZodError) {
    logError("Validation payload error", error);
    return NextResponse.json(
      { error: "Invalid request payload", details: error.flatten() },
      { status: 400 },
    );
  }

  logError("Unhandled API error", error);
  const message =
    error instanceof Error && error.message ? error.message : "Something went wrong";
  return NextResponse.json({ error: message }, { status: 500 });
}
