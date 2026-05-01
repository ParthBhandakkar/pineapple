import { getCurrentUser } from "@/lib/auth";
import { DashboardClient } from "@/components/DashboardClient";

export default async function DashboardPage() {
  await getCurrentUser();

  return <DashboardClient />;
}
