import { ReactNode } from "react";
import { Sidebar, SIDEBAR_COLLAPSED_WIDTH } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MessageNotifications } from "./MessageNotifications";
import { CRMAlerts } from "./CRMAlerts";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { GroupSecretaryPopup } from "./GroupSecretaryPopup";
import { SoundToggle } from "./SoundToggle";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col xl:flex-row">
      <Sidebar />
      <TopBar />
      
      {/* Mobile/Tablet TopBar with notifications */}
      <div className="xl:hidden fixed top-0 right-0 left-12 h-14 flex items-center justify-end gap-2 px-3 bg-background/95 backdrop-blur-sm border-b border-border/50 z-50">
        <ConnectionStatusIndicator />
        <div className="h-5 w-px bg-border" />
        <MessageNotifications />
        <CRMAlerts />
        <SoundToggle />
      </div>
      
      {/* Desktop: margin-left for collapsed sidebar + top bar, Mobile/Tablet: no margin */}
      <main className="xl:ml-16 pt-14 xl:pt-12 overflow-x-hidden overflow-y-auto w-full xl:w-[calc(100vw-4rem)] h-full box-border">
        <div className="p-2 xl:p-3 2xl:p-4 w-full min-w-0 overflow-x-hidden">{children}</div>
      </main>
      <GroupSecretaryPopup />
    </div>
  );
}
