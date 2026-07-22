import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Calendar, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useDevPortal, submitPortalRequest } from "@/hooks/use-dev-workspace";

export default function ClientPortal() {
  const { token = "" } = useParams();
  const { data, isLoading, error } = useDevPortal(token);
  const [form, setForm] = useState({ title: "", description: "", contact_email: "" });
  const [sending, setSending] = useState(false);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !data) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Portal indisponível.</div>;

  const { project, phases = [], modules = [] } = data;
  const totalDone = phases.filter((p: any) => p.status === "done").length;
  const pct = phases.length > 0 ? Math.round((totalDone / phases.length) * 100) : 0;

  const send = async () => {
    if (!form.title) return;
    setSending(true);
    try {
      await submitPortalRequest(token, form);
      toast.success("Pedido enviado! A equipe já foi notificada.");
      setForm({ title: "", description: "", contact_email: "" });
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">{project.name}</h1>
          {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Progresso geral</CardTitle></CardHeader>
          <CardContent>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>{totalDone}/{phases.length} fases</span><span>{pct}%</span></div>
            <Progress value={pct} className="h-3" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Fases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {phases.map((p: any) => {
              const mod = modules.find((m: any) => m.id === p.module_id);
              const done = p.status === "done";
              return (
                <div key={p.id} className="border rounded p-3 flex items-center gap-3">
                  {done ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    {mod && <div className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: mod.color }} /> {mod.name}</div>}
                  </div>
                  {p.due_date && <Badge variant={done ? "secondary" : "outline"} className="shrink-0"><Calendar className="h-3 w-3 mr-1" /> {new Date(p.due_date).toLocaleDateString("pt-BR")}</Badge>}
                </div>
              );
            })}
            {phases.length === 0 && <p className="text-sm text-muted-foreground">Fases ainda não definidas.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Enviar um pedido</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Resumo do que você precisa" /></div>
            <div><Label>Detalhes</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descreva o pedido, print, contexto…" /></div>
            <div><Label>Seu e-mail (opcional)</Label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
            <Button onClick={send} disabled={!form.title || sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Enviar</>}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}