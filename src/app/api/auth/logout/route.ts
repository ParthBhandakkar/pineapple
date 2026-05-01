import { clearSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function POST() {
  try {
    await clearSession();
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
