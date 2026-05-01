export function logError(context: string, error: unknown, details?: Record<string, unknown>) {
  if (error instanceof Error) {
    if (details) {
      console.error(`[${context}]`, error.message, { ...details, stack: error.stack });
    } else {
      console.error(`[${context}]`, error);
    }
    return;
  }

  if (details) {
    console.error(`[${context}]`, { ...details, error });
  } else {
    console.error(`[${context}]`, error);
  }
}
