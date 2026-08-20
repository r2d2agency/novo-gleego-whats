import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Trash2, Facebook, Instagram, Phone, AlertTriangle, CheckCircle2, XCircle, ArrowLeft, Shield, ExternalLink, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Status {
  configured: boolean;
  app_id_configured: boolean;
  app_secret_configured: boolean;
  webhook_verify_token_configured: boolean;
  whatsapp_config_id_configured: boolean;
  connections_count: number;
  pages_count: number;
}

interface Connection {
  id: string;
  organization_id: string;
  user_id: string;
  provider: string;
  fb_user_id: string | null;
  token_expires_at: string | null;
  scopes: string[];
  created_at: string;
  updated_at: string;
}

interface Page {
  id: string;
  organization_id: string;
  oauth_connection_id: string;
  kind: string;
  external_id: string;
  external_name: string | null;
  status: string;
  phone_number: string | null;
  created_at: string;
}

export default function AdminMetaSaas() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [orgMap, setOrgMap] = useState<Map<string, { id: string; name: string; slug: string }>>(new Map());
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const isSuperadmin = user?.is_superadmin === true;

  const load = async () => {
    setLoading(true);
    try {
      const [statusData, connData] = await Promise.all([
        api<Status>("/api/meta/admin/status"),
        api<{ connections: Connection[]; pages: Page[]; organizations: Record<string, { id: string; name: string; slug: string }> }>("/api/meta/admin/connections"),
      ]);
      setStatus(statusData);
      setConnections(connData.connections ?? []);
      setPages(connData.pages ?? []);
      setOrgMap(new Map(connData.organizations ? Object.entries(connData.organizations) : []));
    } catch (e: any) {
      toast.error(e.message || "Erro ao carregar dados do Meta SaaS");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperadmin) {
      toast.error("Acesso negado. Apenas superadmins.");
      navigate("/admin");
      return;
    }
    load();
  }, [isSuperadmin, navigate]);

  const handleRevoke = async (connectionId: string) => {
    setActiveAction(connectionId);
    try {
      await api("/api/meta/admin/revoke", { method: "POST", body: { connection_id: connectionId } });
      toast.success("Conexão revogada com sucesso");
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao revogar");
    } finally {
      setActiveAction(null);
    }
  };

  const handleSync = async (connectionId: string) => {
    setActiveAction(`sync-${connectionId}`);
    try {
      await api("/api/meta/admin/sync", { method: "POST", body: { connection_id: connectionId } });
      toast.success("Sincronização solicitada");
      load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao sincronizar");
    } finally {
      setActiveAction(null);
    }
  };

  const providerIcon = (provider: string) => {
    if (provider === "instagram") return <Instagram className="h-4 w-4" />;
    if (provider === "whatsapp") return <Phone className="h-4 w-4" />;
    return <Facebook className="h-4 w-4" />;
  };

  const providerLabel = (p: string) =>
    ({ facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" }[p] ?? p);

  const kindLabel = (k: string) =>
    ({ facebook_page: "Página", instagram_account: "Instagram", whatsapp_number: "WhatsApp" }[k] ?? k);

  if (!isSuperadmin) return null;

  return (
    <MainLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Admin Meta SaaS
              </h1>
              <p className="text-sm text-muted-foreground">
                Gerenciamento centralizado das conexões Meta das organizações.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatusCard
            title="App central"
            ok={status?.configured}
            okText="Configurado"
            badText="Pendente"
            description={status?.configured ? "Secrets presentes" : "Cadastre META_APP_ID, META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN"}
          />
          <StatusCard
            title="App ID"
            ok={status?.app_id_configured}
            okText="Sim"
            badText="Não"
            description="Identificador do App Gleego no Meta"
          />
          <StatusCard
            title="Conexões"
            value={status?.connections_count ?? 0}
            description="Organizações conectadas"
          />
          <StatusCard
            title="Ativos"
            value={status?.pages_count ?? 0}
            description="Páginas/IG/WABA ativas"
          />
        </div>

        <Tabs defaultValue="connections" className="space-y-4">
          <TabsList>
            <TabsTrigger value="connections">Conexões</TabsTrigger>
            <TabsTrigger value="pages">Páginas e números</TabsTrigger>
            <TabsTrigger value="setup">Configuração</TabsTrigger>
          </TabsList>

          <TabsContent value="connections" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conexões OAuth</CardTitle>
                <CardDescription>
                  Cada linha representa uma autorização de usuário/organização no App central da Gleego.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : connections.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma conexão Meta centralizada ainda.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organização</TableHead>
                        <TableHead>Provedor</TableHead>
                        <TableHead>ID Meta</TableHead>
                        <TableHead>Expiração</TableHead>
                        <TableHead>Criado em</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connections.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">
                            {orgMap.get(c.organization_id)?.name ?? c.organization_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              {providerIcon(c.provider)}
                              {providerLabel(c.provider)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{c.fb_user_id ?? "—"}</TableCell>
                          <TableCell>
                            {c.token_expires_at
                              ? new Date(c.token_expires_at).toLocaleDateString("pt-BR")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {new Date(c.created_at).toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() => handleSync(c.id)}
                                disabled={!!activeAction}
                                title="Sincronizar"
                              >
                                {activeAction === `sync-${c.id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="destructive" title="Revogar">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Revogar conexão?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Isso remove o token e inativa todas as páginas/números vinculados desta organização.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleRevoke(c.id)}>
                                      {activeAction === c.id && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                      Revogar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Páginas, Instagram e WhatsApp</CardTitle>
                <CardDescription>
                  Ativos descobertos nas conexões autorizadas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : pages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma página, conta Instagram ou número WhatsApp conectado ainda.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organização</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Nome / Número</TableHead>
                        <TableHead>ID Externo</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pages.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {orgMap.get(p.organization_id)?.name ?? p.organization_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{kindLabel(p.kind)}</Badge>
                          </TableCell>
                          <TableCell>
                            {p.external_name ?? p.phone_number ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{p.external_id}</TableCell>
                          <TableCell>
                            <Badge variant={p.status === "active" ? "default" : "secondary"}>
                              {p.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="setup" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuração do Webhook (Meta Developers)</CardTitle>
                <CardDescription>
                  Copie estes valores e cole nas configurações de Webhook do seu App na Meta.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase font-semibold">Callback URL</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={`${API_URL}/api/meta/webhook`} className="bg-muted font-mono text-xs" />
                    <Button variant="outline" size="sm" onClick={() => {
                      navigator.clipboard.writeText(`${API_URL}/api/meta/webhook`);
                      toast.success("URL copiada!");
                    }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase font-semibold">Verify Token</Label>
                  <div className="flex gap-2">
                    <Input 
                      readOnly 
                      value={status?.webhook_verify_token_configured ? "••••••••••••" : "Não configurado"} 
                      className="bg-muted font-mono text-xs" 
                    />
                    <Button variant="outline" size="sm" onClick={() => {
                      toast.info("O token está configurado no backend (META_WEBHOOK_VERIFY_TOKEN).");
                    }}>
                      <Shield className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-primary" />
                    Onde configurar?
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    1. Vá em <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-primary hover:underline">developers.facebook.com/apps</a><br/>
                    2. Selecione seu App &gt; Webhooks &gt; Editar Assinatura.<br/>
                    3. Cole a <strong>Callback URL</strong> acima.<br/>
                    4. O <strong>Verify Token</strong> é o valor que você definiu na variável <code className="text-primary">META_WEBHOOK_VERIFY_TOKEN</code> no seu servidor.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Secrets necessários (Easypanel / Cloud)</CardTitle>
                <CardDescription>
                  Certifique-se de que estas variáveis de ambiente estão configuradas no seu serviço de backend.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SecretRow name="META_APP_ID" configured={status?.app_id_configured} />
                <SecretRow name="META_APP_SECRET" configured={status?.app_secret_configured} />
                <SecretRow name="META_WEBHOOK_VERIFY_TOKEN" configured={status?.webhook_verify_token_configured} />
                <SecretRow name="META_CONFIG_ID_WHATSAPP" configured={status?.whatsapp_config_id_configured} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function StatusCard({
  title,
  ok,
  okText,
  badText,
  value,
  description,
}: {
  title: string;
  ok?: boolean;
  okText?: string;
  badText?: string;
  value?: number | string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-2xl font-bold">
          {value !== undefined ? (
            value
          ) : ok ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-green-500" /> {okText}
            </>
          ) : (
            <>
              <XCircle className="h-6 w-6 text-destructive" /> {badText}
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

function SecretRow({ name, configured }: { name: string; configured?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <code className="text-sm font-semibold">{name}</code>
      {configured ? (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Cadastrado
        </Badge>
      ) : (
        <Badge variant="secondary" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> Pendente
        </Badge>
      )}
    </div>
  );
}
