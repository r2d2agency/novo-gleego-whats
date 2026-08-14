import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, BellOff, Timer, User } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useGroupSecretary, type SecretaryFollowup } from "@/hooks/use-group-secretary";

export default function SecretaryFollowupsPanel() {
  const { getFollowups, toggleFollowup, stopAllFollowups } = useGroupSecretary();
  const [items, setItems] = useState<SecretaryFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getFollowups());
    } catch {
      toast.error("Erro ao carregar follow-ups");
    } finally {
      setLoading(false);
    }
  }, [getFollowups]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = async (item: SecretaryFollowup, active: boolean) => {
    setBusy(item.id);
    try {
      await toggleFollowup(item.id, !active);
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, followup_disabled: !active } : p)));
      toast.success(active ? "Follow-up reativado" : "Follow-up desativado");
    } catch {
      toast.error("Erro ao atualizar follow-up");
    } finally {
      setBusy(null);
    }
  };

  const handleStopAll = async () => {
    setBusy("all");
    try {
      const stopped = await stopAllFollowups();
      toast.success(`${stopped} follow-up(s) desativado(s)`);
      await load();
    } catch {
      toast.error("Erro ao parar follow-ups");
    } finally {
      setBusy(null);
    }
  };

  const activeCount = items.filter((i) => !i.followup_disabled).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-4 w-4 text-primary" />
            Follow-ups ativos
            <Badge variant="secondary">{activeCount}</Badge>
          </CardTitle>
          <CardDescription>
            Tarefas pendentes criadas pela Secretária IA. Cada tarefa recebe no máximo 3 lembretes e para de cobrar após 7 dias.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStopAll}
            disabled={busy === "all" || activeCount === 0}
          >
            {busy === "all" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BellOff className="h-4 w-4 mr-2" />}
            Parar todos
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nenhum follow-up pendente no momento.
          </p>
        ) : (
          <ScrollArea className="max-h-[480px] pr-2">
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {item.assigned_to_name || "Sem responsável"}
                      </span>
                      <span>
                        Criada {format(new Date(item.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </span>
                      <Badge variant="outline">{item.followup_count}/3 lembretes</Badge>
                      {item.followup_disabled && <Badge variant="secondary">Desativado</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {busy === item.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <Switch
                      checked={!item.followup_disabled}
                      onCheckedChange={(v) => handleToggle(item, v)}
                      disabled={busy === item.id}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
