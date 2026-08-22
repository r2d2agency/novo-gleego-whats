import { useEffect } from "react";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { AttendanceChart } from "@/components/dashboard/AttendanceChart";
import { HourlyChart } from "@/components/dashboard/HourlyChart";
import { QuickActionsGrid } from "@/components/dashboard/QuickActionsGrid";

const Index = () => {
  useEffect(() => {
    // Schema fixes were already applied in previous turns.
  }, []);

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <DashboardHeader />
      <DashboardStats />
      
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-7">
        <AttendanceChart className="col-span-1 md:col-span-2 lg:col-span-4" />
        <HourlyChart className="col-span-1 md:col-span-2 lg:col-span-3" />
      </div>

      <QuickActionsGrid />
    </div>
  );
};

export default Index;
