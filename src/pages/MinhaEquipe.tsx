import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Users, CheckCircle2, AlertTriangle, TrendingUp, Search, SlidersHorizontal,
  ChevronRight, Plus, Sparkles, ArrowUpRight, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface OrgUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
}

type Status = "atencao" | "no_ritmo" | "em_risco" | "evoluindo" | "top";

interface Member extends OrgUser {
  status: Status;
  core: number;
  metricLabel: string;
  metricValue: string;
  metricTone: "danger" | "warn" | "ok";
  role_label: string;
}

// Deterministic pseudo-random from id so metrics are stable per user
function hash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const STATUS_META: Record<Status, { label: string; className: string; dot: string }> = {
  atencao:   { label: "Atenção",  className: "bg-red-50 text-red-600 border-red-100",       dot: "bg-red-500" },
  no_ritmo:  { label: "No ritmo", className: "bg-emerald-50 text-emerald-600 border-emerald-100", dot: "bg-emerald-500" },
  em_risco:  { label: "Em risco", className: "bg-rose-50 text-rose-600 border-rose-100",    dot: "bg-rose-500" },
  evoluindo: { label: "Evoluindo",className: "bg-blue-50 text-blue-600 border-blue-100",    dot: "bg-blue-500" },
  top:       { label: "Top",      className: "bg-violet-50 text-violet-600 border-violet-100", dot: "bg-violet-500" },
};

function buildMember(u: OrgUser): Member {
  const h = hash(u.id || u.email || u.name);
  const core = 45 + (h % 55); // 45-99
  const statuses: Status[] = ["atencao", "no_ritmo", "em_risco", "evoluindo", "top"];
  // Derive status from core
  let status: Status;
  if (core >= 88) status = "top";
  else if (core >= 78) status = h % 3 === 0 ? "evoluindo" : "no_ritmo";
  else if (core >= 65) status = "atencao";
  else status = "em_risco";

  // Metric secundária
  const metricPool: Array<{ label: string; value: string; tone: "danger" | "warn" | "ok" }> = [
    { label: "Último feedback", value: `${(h % 45) + 1} dias`, tone: (h % 45) > 20 ? "danger" : "ok" },
    { label: "PDI",              value: h % 2 === 0 ? "Atualizado" : "Parado", tone: h % 2 === 0 ? "ok" : "warn" },
    { label: "Último 1:1",       value: `${(h % 15) + 1} dias`, tone: (h % 15) > 10 ? "warn" : "ok" },
    { label: "Entregas",         value: h % 4 === 0 ? "Atrasadas" : "Em dia",  tone: h % 4 === 0 ? "danger" : "ok" },
  ];
  const m = metricPool[h % metricPool.length];

  return {
    ...u,
    status,
    core,
    metricLabel: m.label,
    metricValue: m.value,
    metricTone: m.tone,
    role_label: u.role || "Membro",
  };
}

function StatCard({ icon: Icon, value, label, sub, tone }: {
  icon: any; value: number | string; label: string; sub?: string;
  tone: "neutral" | "ok" | "warn" | "info";
}) {
  const toneMap = {
    neutral: "bg-muted/40 text-foreground",
    ok:      "bg-emerald-50 text-emerald-600",
    warn:    "bg-amber-50 text-amber-600",
    info:    "bg-blue-50 text-blue-600",
  } as const;
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-3 sm:p-4">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center mb-3", toneMap[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1.5">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground/80 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function MemberRow({ m }: { m: Member }) {
  const meta = STATUS_META[m.status];
  const initials = m.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
  const coreTone =
    m.core >= 85 ? "text-emerald-600" :
    m.core >= 70 ? "text-amber-600" : "text-rose-600";
  const metricTone =
    m.metricTone === "ok" ? "text-emerald-600" :
    m.metricTone === "warn" ? "text-amber-600" : "text-rose-600";

  return (
    <Card className="border-border/60 shadow-none hover:shadow-sm transition-shadow cursor-pointer">
      <CardContent className="p-3 flex items-center gap-3">
        <Avatar className="h-11 w-11">
          <AvatarImage src={m.avatar_url || undefined} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{m.name}</div>
          <div className="text-xs text-muted-foreground truncate">{m.role_label}</div>
        </div>
        <div className="hidden sm:flex">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", meta.className)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
            {meta.label}
          </span>
        </div>
        <div className="hidden md:block text-center min-w-[64px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CORE</div>
          <div className={cn("font-bold text-base", coreTone)}>{m.core}</div>
        </div>
        <div className="text-right min-w-[96px]">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{m.metricLabel}</div>
          <div className={cn("font-semibold text-sm", metricTone)}>{m.metricValue}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardContent>
    </Card>
  );
}

const TABS: { key: "todos" | Status; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "atencao", label: "Atenção" },
  { key: "em_risco", label: "Em risco" },
  { key: "evoluindo", label: "Evoluindo" },
  { key: "top", label: "Top performers" },
];

export default function MinhaEquipe() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [tab, setTab] = useState<"todos" | Status>("todos");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api<OrgUser[]>("/api/chatbots/org/users", { auth: true });
        setUsers(data || []);
      } catch (e) {
        console.error(e);
        toast.error("Não foi possível carregar a equipe");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const members: Member[] = useMemo(() => users.map(buildMember), [users]);

  const counts = useMemo(() => {
    const c = { atencao: 0, no_ritmo: 0, em_risco: 0, evoluindo: 0, top: 0 };
    members.forEach(m => { c[m.status]++; });
    return c;
  }, [members]);

  const health = useMemo(() => {
    if (!members.length) return 0;
    return Math.round(members.reduce((s, m) => s + m.core, 0) / members.length);
  }, [members]);

  const noRitmo = counts.no_ritmo + counts.evoluindo + counts.top;
  const precisamAtencao = counts.atencao + counts.em_risco;
  const pctNoRitmo = members.length ? Math.round((noRitmo / members.length) * 100) : 0;
  const pctAtencao = members.length ? Math.round((precisamAtencao / members.length) * 100) : 0;

  const filtered = members.filter(m => {
    if (tab !== "todos" && m.status !== tab) return false;
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const coachTarget = members.find(m => m.metricLabel === "Último feedback" && m.metricTone === "danger");

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto space-y-6 pb-24">
        {/* Header */}
        <header className="space-y-3">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Equipe</div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">Minha equipe</h1>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-xl">
                Acompanhe sua equipe, veja indicadores individuais e identifique quem precisa da sua atenção.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="rounded-full h-10 w-10 shrink-0">
                <Search className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="rounded-full h-10 gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Filtros
              </Button>
            </div>
          </div>
          <Input
            placeholder="Buscar pessoa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-md"
          />
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Users}         tone="neutral" value={members.length} label="Pessoas" sub="na sua equipe" />
          <StatCard icon={CheckCircle2}  tone="ok"      value={noRitmo}        label="No ritmo" sub={`${pctNoRitmo}% da equipe`} />
          <StatCard icon={AlertTriangle} tone="warn"    value={precisamAtencao} label="Precisam atenção" sub={`${pctAtencao}% da equipe`} />
          <StatCard icon={TrendingUp}    tone="info"    value={health}          label="Health Score" sub="da equipe" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {TABS.map(t => {
            const active = tab === t.key;
            const count = t.key === "todos" ? 0 : (counts as any)[t.key] || 0;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                )}
              >
                {t.label}
                {t.key !== "todos" && count > 0 && (
                  <Badge
                    className={cn(
                      "h-5 min-w-5 px-1.5 rounded-full text-[10px] font-bold",
                      active ? "bg-background text-foreground" : "bg-red-500 text-white hover:bg-red-500"
                    )}
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando equipe...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            Nenhum membro nesse filtro.
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map(m => <MemberRow key={m.id} m={m} />)}
          </div>
        )}

        {/* Invite */}
        <button className="w-full rounded-2xl border-2 border-dashed border-border py-4 flex items-center justify-center gap-2 text-sm font-medium text-foreground/80 hover:bg-muted/40 transition-colors">
          <Plus className="h-4 w-4" />
          Convidar pessoa para a equipe
        </button>

        {/* IA Coach */}
        <Card className="border-violet-200/60 bg-gradient-to-br from-violet-50 to-white shadow-none">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">IA Coach</div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {coachTarget
                  ? `${coachTarget.name} está há ${coachTarget.metricValue} sem feedback. Deseja preparar uma conversa?`
                  : "Tudo em ordem por aqui. Quer preparar um 1:1 com alguém da equipe?"}
              </p>
            </div>
            <Button variant="outline" className="rounded-full gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 shrink-0">
              Preparar conversa
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
