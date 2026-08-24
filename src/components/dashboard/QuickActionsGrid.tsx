import { Users, MessageSquare, Send, Headphones, BarChart3, Settings, Bot, Briefcase, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const allActions = [
  { key: "chat", label: "Atendimento", icon: Headphones, path: "/chat", color: "text-blue-500", module: "chat" as const },
  { key: "contacts", label: "Contatos", icon: Users, path: "/contatos", color: "text-primary", module: null },
  { key: "messages", label: "Mensagens", icon: MessageSquare, path: "/mensagens", color: "text-primary", module: null },
  { key: "campaigns", label: "Campanhas", icon: Send, path: "/campanhas", color: "text-green-600", module: "campaigns" as const },
  { key: "crm", label: "CRM", icon: Briefcase, path: "/crm/negociacoes", color: "text-purple-500", module: "crm" as const },
  { key: "ai", label: "Agentes IA", icon: Bot, path: "/agentes-ia", color: "text-amber-500", module: "ai_agents" as const },
  { key: "reports", label: "Relatórios", icon: BarChart3, path: "/crm/relatorios", color: "text-emerald-500", module: "crm" as const },
  { key: "surveys", label: "Pesquisas", icon: Star, path: "/pesquisas", color: "text-orange-500", module: null },
  { key: "settings", label: "Configurações", icon: Settings, path: "/configuracoes", color: "text-muted-foreground", module: null },
];

export function QuickActionsGrid() {
  const navigate = useNavigate();
  const { modulesEnabled } = useAuth();

  const visibleActions = allActions.filter(a => {
    if (!a.module) return true;
    return modulesEnabled[a.module];
  });

  return (
    <div className="grid grid-cols-4 gap-2">
      {visibleActions.slice(0, 8).map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            onClick={() => navigate(action.path)}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border/50 bg-card hover:bg-accent/50 hover:border-primary/30 transition-all duration-200 group"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
              <Icon className={`h-5 w-5 ${action.color}`} />
            </div>
            <span className="text-[11px] font-medium text-foreground">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
