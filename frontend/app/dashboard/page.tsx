import type { Metadata } from "next";
import { Dashboard } from "@/features/dashboard";

export const metadata: Metadata = {
  title: "Undertow — Live feed",
};

// Route protection lives in middleware.ts (getToken redirect), not here.
export default function DashboardPage() {
  return <Dashboard />;
}
