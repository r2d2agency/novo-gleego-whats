import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMetaPages, useMetaLeadForms, useMetaLeadEvents, type MetaLeadForm } from "@/hooks/use-meta-lead-ads";
import { useConnections } from "@/hooks/use-connections";
import { useCRMFunnels, useCRMFunnel } from "@/hooks/use-crm";
import { Facebook, RefreshCw, Trash2, Plus, RotateCw, CheckCircle2, AlertCircle, Clock, Inbox } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    received: { label: "Recebido", cls: "bg-blue-500/15 text-blue-600", icon: Clock },
    processed: { label: "Processado", cls: "bg-green-500/15 text-green-600", icon: CheckCircle2 },
    failed: { label: "Falhou", cls: "bg-red-500/15 text-red-600", icon: AlertCircle },
  };
  const m = map[status] || map.received;
  const Icon = m.icon;
  return (
    <Badge className={`gap-1 ${m.cls} border-transparent`}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

function AddPageDialog() {
  const { createPage } = useMetaPages();
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [token, setToken] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Conectar página</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar página do Facebook</DialogTitle>
          <DialogDescription>
            Cadastro manual via Page Access Token (modo provisório enquanto o "Conectar com Facebook" finaliza no App Review).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>ID da Página</Label>
            <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="ex: 102345678901234" />
          </div>
          <div className="space-y-1.5">
            <Label>Nome (opcional)</Label>
            <Input value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="Nome da página" />
          </div>
          <div className="space-y-1.5">
            <Label>Page Access Token</Label>
            <Textarea value={token} onChange={(e) => setToken(e.target.value)} rows={4} placeholder="EAA..." />
            <p className="text-xs text-muted-foreground">
              Gerado no Graph API Explorer com permissão <code>leads_retrieval</code>.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            disabled={!pageId || !token || createPage.isPending}
            onClick={async () => {
              await createPage.mutateAsync({ page_id: pageId, page_name: pageName || undefined, page_access_token: token });
              setOpen(false); setPageId(""); setPageName(""); setToken("");
            }}
          >Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormConfigDialog({ form, onClose }: { form: MetaLeadForm; onClose: () => void }) {
  const { updateForm } = useMetaLeadForms();
  const { data: connections = [] } = useConnections();
  const { data: funnels = [] } = useCRMFunnels();
  const [isActive, setIsActive] = useState(form.is_active);
  const [openChat, setOpenChat] = useState(form.open_chat);
  const [connectionId, setConnectionId] = useState<string>(form.connection_id || "none");
  const [funnelId, setFunnelId] = useState<string>(form.funnel_id || "none");
  const [stageId, setStageId] = useState<string>(form.stage_id || "none");
  const { data: selectedFunnel } = useCRMFunnel(funnelId === "none" ? null : funnelId);
  const [mappingText, setMappingText] = useState(JSON.stringify(form.field_mapping || {}, null, 2));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.form_name || form.form_id}</DialogTitle>
          <DialogDescription>Configuração de entrega no CRM</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm">Ativo</Label>
              <p className="text-xs text-muted-foreground">Receber e processar leads</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm">Abrir conversa</Label>
              <p className="text-xs text-muted-foreground">Cria contato no chat ao receber</p>
            </div>
            <Switch checked={openChat} onCheckedChange={setOpenChat} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Funil CRM de destino</Label>
            <Select value={funnelId} onValueChange={(value) => { setFunnelId(value); setStageId("none"); }}>
              <SelectTrigger><SelectValue placeholder="Selecione o funil" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem funil</SelectItem>
                {(funnels as any[]).map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Etapa inicial</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={funnelId === "none"}>
              <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Primeira etapa automática</SelectItem>
                {(selectedFunnel?.stages || []).map((stage: any) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Conexão WhatsApp (para abrir conversa)</Label>
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhuma</SelectItem>
              {connections.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Mapeamento de campos (JSON)</Label>
          <Textarea
            rows={6}
            value={mappingText}
            onChange={(e) => setMappingText(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Ex: <code>{`{"full_name":"name","phone_number":"phone","email":"email","city":"city"}`}</code>.
            Campos não mapeados vão para custom_fields automaticamente.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={updateForm.isPending}
            onClick={async () => {
              let mapping: Record<string, string> = {};
              try { mapping = JSON.parse(mappingText || "{}"); } catch { /* keep current */ }
              await updateForm.mutateAsync({
                id: form.id,
                is_active: isActive,
                open_chat: openChat,
                connection_id: connectionId === "none" ? null : connectionId,
                funnel_id: funnelId === "none" ? null : funnelId,
                stage_id: stageId === "none" ? null : stageId,
                field_mapping: mapping,
              });
              onClose();
            }}
          >Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MetaLeadAds() {
  const pages = useMetaPages();
  const forms = useMetaLeadForms();
  const events = useMetaLeadEvents();
  const [editing, setEditing] = useState<MetaLeadForm | null>(null);

  return (
    <MainLayout>
      <div className="container max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Facebook className="h-6 w-6 text-primary" /> Meta Lead Ads
            </h1>
            <p className="text-sm text-muted-foreground">
              Receba leads dos formulários do Facebook/Instagram direto no CRM.
            </p>
          </div>
        </header>

        <Tabs defaultValue="pages">
          <TabsList>
            <TabsTrigger value="pages">Páginas</TabsTrigger>
            <TabsTrigger value="forms">Formulários</TabsTrigger>
            <TabsTrigger value="events">Leads recebidos</TabsTrigger>
          </TabsList>

          <TabsContent value="pages" className="space-y-3">
            <div className="flex justify-end"><AddPageDialog /></div>
            {pages.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (pages.data?.length ?? 0) === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">
                Nenhuma página conectada ainda.
              </CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {pages.data!.map((p) => (
                  <Card key={p.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{p.external_name || p.external_id}</span>
                        <Badge variant="outline">{p.status}</Badge>
                      </CardTitle>
                      <CardDescription className="text-xs">ID: {p.external_id}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{p.forms_count} formulários</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="gap-1"
                          disabled={pages.syncForms.isPending}
                          onClick={() => pages.syncForms.mutate(p.id)}>
                          <RefreshCw className="h-3.5 w-3.5" /> Sincronizar
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive"
                          onClick={() => { if (confirm("Remover esta página?")) pages.deletePage.mutate(p.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="forms" className="space-y-3">
            {forms.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (forms.data?.length ?? 0) === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">
                Nenhum formulário. Sincronize uma página primeiro.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {forms.data!.map((f) => (
                  <Card key={f.id}>
                    <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{f.form_name || f.form_id}</p>
                        <p className="text-xs text-muted-foreground">
                          Página: {f.page_name || f.page_external_id} · {f.leads_count ?? 0} leads
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={f.is_active ? "default" : "secondary"}>
                          {f.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                        {f.open_chat && <Badge variant="outline">Abre chat</Badge>}
                        <Button size="sm" variant="outline" onClick={() => setEditing(f)}>Configurar</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-3">
            {events.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : (events.data?.length ?? 0) === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Inbox className="h-6 w-6" /> Nenhum lead recebido ainda.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {events.data!.map((e) => (
                  <Card key={e.id}>
                    <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={e.status} />
                          <p className="font-medium truncate">{e.prospect_name || e.form_name || e.leadgen_id}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {e.page_name} · {new Date(e.received_at).toLocaleString("pt-BR")}
                          {e.error && <span className="text-destructive"> · {e.error}</span>}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1"
                        disabled={events.reprocess.isPending}
                        onClick={() => events.reprocess.mutate(e.id)}>
                        <RotateCw className="h-3.5 w-3.5" /> Reprocessar
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {editing && <FormConfigDialog form={editing} onClose={() => setEditing(null)} />}
      </div>
    </MainLayout>
  );
}