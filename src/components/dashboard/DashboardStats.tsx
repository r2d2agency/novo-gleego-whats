import { Users, MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { StatsCard } from "./StatsCard";

export function DashboardStats() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Contatos Totais"
        value="0"
        icon={<Users className="h-6 w-6 text-primary" />}
        description="Contatos na base"
      />
      <StatsCard
        title="Mensagens Recebidas"
        value="0"
        icon={<MessageSquare className="h-6 w-6 text-primary" />}
        description="Últimos 30 dias"
      />
      <StatsCard
        title="Campanhas Ativas"
        value="0"
        icon={<Send className="h-6 w-6 text-primary" />}
        description="Em execução no momento"
      />
      <StatsCard
        title="Conversas Concluídas"
        value="0"
        icon={<CheckCircle2 className="h-6 w-6 text-primary" />}
        description="Finalizadas hoje"
      />
    </div>
  );
}

