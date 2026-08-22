import { Users, MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { StatsCard } from "./StatsCard";

export function DashboardStats() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Contatos Totais"
        value="0"
        icon={Users}
        description="Contatos na base"
      />
      <StatsCard
        title="Mensagens Recebidas"
        value="0"
        icon={MessageSquare}
        description="Últimos 30 dias"
      />
      <StatsCard
        title="Campanhas Ativas"
        value="0"
        icon={Send}
        description="Em execução no momento"
      />
      <StatsCard
        title="Conversas Concluídas"
        value="0"
        icon={CheckCircle2}
        description="Finalizadas hoje"
      />
    </div>
  );
}
