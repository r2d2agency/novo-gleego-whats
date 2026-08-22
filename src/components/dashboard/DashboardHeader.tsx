import { LayoutDashboard } from "lucide-react";

export function DashboardHeader() {
  return (
    <div className="flex items-center justify-between space-y-2">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
      </div>
    </div>
  );
}
