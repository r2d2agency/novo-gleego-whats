import { useState, useEffect, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { ConnectionStatus } from "@/components/dashboard/ConnectionStatus";
import { AttendanceChart } from "@/components/dashboard/AttendanceChart";
import { HourlyChart } from "@/components/dashboard/HourlyChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { MetricRing } from "@/components/dashboard/MetricRing";
import { QuickActionsGrid } from "@/components/dashboard/QuickActionsGrid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Users, MessageSquare, Send, CheckCircle2, Loader2, Play, Clock, 
  Calendar as CalendarIcon, Pause, MessageCircle, CheckCheck, 
  Hourglass, Headphones, Megaphone, TrendingUp, Activity, 
  Zap, BarChart3
} from "lucide-react";
import { useContacts } from "@/hooks/use-contacts";
import { useMessages } from "@/hooks/use-messages";
import { useCampaigns, Campaign } from "@/hooks/use-campaigns";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useChat } from "@/hooks/use-chat";
import { useAuth } from "@/contexts/AuthContext";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";
import { chatEvents } from "@/lib/chat-events";

interface DashboardStats {
  totalContacts: number;
  totalMessages: number;
  activeCampaigns: number;
  scheduledCampaigns: number;
  sentMessages: number;
  conversationsAssigned: number;
  conversationsUnassigned: number;
  conversationsWaiting: number;
  conversationsAttending: number;
  conversationsFinished: number;
  totalUsers: number;
  messagesToday: number;
  messagesWeek: number;
}

const statusConfig = {
  pending: { icon: CalendarIcon, label: "Agendada", color: "text-muted-foreground", bgColor: "bg-muted" },
  running: { icon: Play, label: "Em Execução", color: "text-warning", bgColor: "bg-warning/10" },
  completed: { icon: CheckCircle2, label: "Concluída", color: "text-success", bgColor: "bg-success/10" },
  paused: { icon: Pause, label: "Pausada", color: "text-destructive", bgColor: "bg-destructive/10" },
  cancelled: { icon: Clock, label: "Cancelada", color: "text-muted-foreground", bgColor: "bg-muted" },
};

const Index = () => {
  const { getLists } = useContacts();
  const { getMessages } = useMessages();
  const { getCampaigns } = useCampaigns();
  const { connections, hasConnectedConnection, isLoading: connectionLoading } = useConnectionStatus({ intervalSeconds: 30 });
  const { getChatStats } = useChat();
  const { modulesEnabled } = useAuth();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalContacts: 0,
    totalMessages: 0,
    activeCampaigns: 0,
    scheduledCampaigns: 0,
    sentMessages: 0,
    conversationsAssigned: 0,
    conversationsUnassigned: 0,
    conversationsWaiting: 0,
    conversationsAttending: 0,
    conversationsFinished: 0,
    totalUsers: 0,
    messagesToday: 0,
    messagesWeek: 0,
  });
  const [recentCampaigns, setRecentCampaigns] = useState<Campaign[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Load critical data first (fast)
      const attendancePromise = api<{ waiting: number; attending: number; finished: number }>('/api/chat/conversations/attendance-counts?is_group=false').catch(() => ({ waiting: 0, attending: 0, finished: 0 }));

      // Load secondary data in parallel
      const [listsData, messagesData, campaignsData, chatStats, attendanceCounts] = await Promise.all([
        getLists().catch(() => []),
        getMessages().catch(() => []),
        getCampaigns().catch(() => []),
        getChatStats().catch(() => null),
        attendancePromise,
      ]);

      const totalContacts = (listsData as any[]).reduce((sum: number, list: any) => sum + Number(list.contact_count || 0), 0);
      const totalMessages = messagesData.length;
      const activeCampaigns = (campaignsData as any[]).filter((c: any) => c.status === 'running').length;
      const scheduledCampaigns = (campaignsData as any[]).filter((c: any) => c.status === 'pending').length;
      const sentMessages = (campaignsData as any[]).reduce((sum: number, c: any) => sum + (c.sent_count || 0), 0);

      const assigned = chatStats?.conversations_by_status?.find(s => s.status === 'assigned')?.count ?? 0;
      const unassigned = chatStats?.conversations_by_status?.find(s => s.status === 'unassigned')?.count ?? 0;

      setStats({
        totalContacts,
        totalMessages,
        activeCampaigns,
        scheduledCampaigns,
        sentMessages,
        conversationsAssigned: assigned,
        conversationsUnassigned: unassigned,
        conversationsWaiting: attendanceCounts.waiting,
        conversationsAttending: attendanceCounts.attending,
        conversationsFinished: attendanceCounts.finished,
        totalUsers: 0,
        messagesToday: chatStats?.messages_today ?? 0,
        messagesWeek: chatStats?.messages_week ?? 0,
      });
      
      if (Array.isArray(campaignsData)) {
        setRecentCampaigns(campaignsData.slice(0, 5));
      } else {
        setRecentCampaigns([]);
      }
      setLoading(false);

      // Load non-critical data after UI renders
      try {
        const orgs = await api<Array<{ id: string; name: string }>>('/api/organizations').catch(() => []);
        const orgId = orgs?.[0]?.id;
        if (orgId) {
          const members = await api<Array<{ id: string }>>(`/api/organizations/${orgId}/members`).catch(() => []);
          setStats(prev => ({ ...prev, totalUsers: members.length }));
        }
      } catch {}
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setLoading(false);
    }
  }, [getLists, getMessages, getCampaigns, getChatStats]);

  // Auto-refresh every 30s + listen for chat events
  useEffect(() => {
    loadDashboardData();
    
    refreshTimerRef.current = setInterval(() => {
      loadDashboardData(true);
    }, 30000);

    const unsubNewMsg = chatEvents.subscribe('new_message', () => {
      loadDashboardData(true);
    });
    const unsubConvUpdate = chatEvents.subscribe('conversation_update', () => {
      loadDashboardData(true);
    });

    return () => {
      clearInterval(refreshTimerRef.current);
      unsubNewMsg();
      unsubConvUpdate();
    };
  }, [loadDashboardData]);
  const firstConnection = connections[0];
  const connectionStatus = firstConnection?.status === 'connected' ? 'connected' : 'disconnected';
  const connectionName = firstConnection?.name || "Nenhuma conexão";
  const connectionPhone = firstConnection?.phoneNumber;
  const totalAttendance = stats.conversationsWaiting + stats.conversationsAttending + stats.conversationsFinished;

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between animate-slide-up">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Visão geral do seu sistema</p>
          </div>
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs">
            <Activity className="h-3 w-3 text-success animate-pulse" />
            {connections.filter(c => c.status === 'connected').length} conexão(ões) ativa(s)
          </Badge>
          <Button variant="outline" size="sm" className="gap-2 ml-2" onClick={() => setShowOnboarding(true)}>
            <Rocket className="h-4 w-4" />
            <span className="hidden sm:inline">Onboarding</span>
          </Button>
        </div>

        {/* Connection */}
        <ConnectionStatus
          status={connectionStatus}
          instanceName={connectionName}
          phoneNumber={connectionPhone}
        />

        {/* KPI Row - Compact */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border/50 bg-gradient-to-br from-card to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Conexões</p>
                  <p className="text-2xl font-bold text-foreground">
                    {connections.filter(c => c.status === 'connected').length}/{connections.length}
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-gradient-to-br from-card to-accent/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Contatos</p>
                  <p className="text-2xl font-bold text-foreground">{stats.totalContacts.toLocaleString('pt-BR')}</p>
                </div>
                <div className="p-2 rounded-lg bg-accent">
                  <Users className="h-5 w-5 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Templates</p>
                  <p className="text-2xl font-bold text-foreground">{stats.totalMessages}</p>
                </div>
                <div className="p-2 rounded-lg bg-secondary">
                  <MessageSquare className="h-5 w-5 text-secondary-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Usuários</p>
                  <p className="text-2xl font-bold text-foreground">{stats.totalUsers}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Grid - 2 columns */}
        <div className="grid gap-6 lg:grid-cols-3">
          
          {/* Left Column - Attendance */}
          <div className="lg:col-span-2 space-y-4">
            {/* Attendance visual summary */}
            <DashboardWidget
              title="Atendimento"
              description="Status das conversas em tempo real"
              icon={<Headphones className="h-4 w-4 text-primary" />}
            >
              <div className="flex items-center justify-around py-2">
                <MetricRing
                  value={stats.conversationsWaiting}
                  max={Math.max(totalAttendance, 1)}
                  label="Aguardando"
                  color="hsl(var(--warning))"
                />
                <MetricRing
                  value={stats.conversationsAttending}
                  max={Math.max(totalAttendance, 1)}
                  label="Atendendo"
                  color="hsl(var(--primary))"
                />
                <MetricRing
                  value={stats.conversationsFinished}
                  max={Math.max(totalAttendance, 1)}
                  label="Finalizados"
                  color="hsl(var(--success))"
                />
                <div className="hidden md:flex flex-col items-center gap-1">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{stats.messagesToday}</p>
                    <p className="text-xs text-muted-foreground">Msgs Hoje</p>
                  </div>
                  <div className="text-center mt-2">
                    <p className="text-lg font-semibold text-foreground">{stats.messagesWeek}</p>
                    <p className="text-[10px] text-muted-foreground">Semana</p>
                  </div>
                </div>
              </div>
              {totalAttendance > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Distribuição</span>
                    <span>{totalAttendance} total</span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                    <div className="bg-warning transition-all" style={{ width: `${(stats.conversationsWaiting / totalAttendance) * 100}%` }} />
                    <div className="bg-primary transition-all" style={{ width: `${(stats.conversationsAttending / totalAttendance) * 100}%` }} />
                    <div className="bg-success transition-all" style={{ width: `${(stats.conversationsFinished / totalAttendance) * 100}%` }} />
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Aguardando</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Atendendo</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Finalizados</span>
                  </div>
                </div>
              )}
            </DashboardWidget>

            {/* Attendance Chart */}
            <AttendanceChart 
              className="animate-fade-in" 
              connections={connections}
              currentCounts={{
                waiting: stats.conversationsWaiting,
                attending: stats.conversationsAttending,
                finished: stats.conversationsFinished,
              }}
            />

            {/* Hourly Distribution Chart */}
            <HourlyChart 
              className="animate-fade-in" 
              connections={connections}
            />
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Quick Actions */}
            <DashboardWidget
              title="Ações Rápidas"
              icon={<Zap className="h-4 w-4 text-primary" />}
            >
              <QuickActionsGrid />
            </DashboardWidget>

            {/* Campaigns Summary */}
            <DashboardWidget
              title="Disparos"
              description={`${stats.activeCampaigns} ativas • ${stats.scheduledCampaigns} agendadas`}
              icon={<Megaphone className="h-4 w-4 text-primary" />}
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-success/10 p-3 text-center">
                    <p className="text-xl font-bold text-success">{stats.activeCampaigns}</p>
                    <p className="text-[10px] text-muted-foreground">Ativas</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-xl font-bold text-foreground">{stats.sentMessages.toLocaleString('pt-BR')}</p>
                    <p className="text-[10px] text-muted-foreground">Enviadas</p>
                  </div>
                </div>
              </div>
            </DashboardWidget>
          </div>
        </div>

        {/* Recent Campaigns - Full Width */}
        <DashboardWidget
          title="Campanhas Recentes"
          description="Últimas campanhas criadas"
          icon={<BarChart3 className="h-4 w-4 text-primary" />}
        >
          {recentCampaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Send className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Nenhuma campanha ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentCampaigns.map((campaign) => {
                const config = statusConfig[campaign.status] || statusConfig.pending;
                const StatusIcon = config.icon;
                return (
                  <div key={campaign.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg", config.bgColor)}>
                        <StatusIcon className={cn("h-4 w-4", config.color)} />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {campaign.list_name || "Lista"} • {campaign.sent_count} enviadas
                        </p>
                      </div>
                    </div>
                    <Badge className={cn(config.bgColor, config.color, "border-0 text-xs")}>
                      {config.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardWidget>
      </div>
      <OnboardingWizard open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </MainLayout>
  );
};

export default Index;
