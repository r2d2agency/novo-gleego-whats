import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Facebook, Instagram, Phone, Loader2, RefreshCw, Link2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { api, API_URL } from "@/lib/api";

interface MetaConnection {
  id: string;
  provider: string;
  fb_user_id: string | null;
  token_expires_at: string | null;
}

interface MetaAsset {
  id: string;
  kind: string;
  external_id: string;
  external_name: string | null;
  status: string;
}

const kindLabel: Record<string, string> = {
  facebook_page: "Página do Facebook",
  instagram_account: "Instagram Business",
  whatsapp_number: "WhatsApp Business",
};

async function toggleAsset(orgId: string, asset: MetaAsset, setActive: boolean) {
  return api(`/api/meta/oauth/assets/${asset.id}`, {
    method: "PATCH",
    body: { organization_id: orgId, status: setActive ? "active" : "paused" },
  });
}

export default function MetaIntegracoes() {
  const { user } = useAuth();
  const [orgId, setOrgId] = useState<string>("");
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [assets, setAssets] = useState<MetaAsset[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setOrgId(user?.organization_id || sessionStorage.getItem("user_org_id") || "");
  }, [user]);

  const loadState = async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const [connData, assetData] = await Promise.all([
        api<{ connections: MetaConnection[] }>(`/api/meta/oauth/connections?organization_id=${encodeURIComponent(id)}`),
        api<{ assets: MetaAsset[] }>(`/api/meta/oauth/assets?organization_id=${encodeURIComponent(id)}`),
      ]);
      setConnections(connData.connections || []);
      setAssets(assetData.assets || []);
    } catch {
      // silencioso: primeira carga pode ocorrer antes do backend estar atualizado
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) loadState(orgId);
  }, [orgId]);

  const startOAuth = async (provider: "facebook" | "instagram" | "whatsapp") => {
    if (!orgId) {
      toast.error("Selecione uma organização antes de conectar.");
      return;
    }
    setStarting(provider);
    try {
      const data = await api<{ url: string }>("/api/meta/oauth/start", {
        method: "POST",
        body: {
          provider,
          organization_id: orgId,
          redirect_uri: `${API_URL}/api/meta/oauth/callback`,
        },
      });
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      toast.error(e.message || "Erro ao iniciar conexão");
    } finally {
      setStarting(null);
    }
  };

  const syncAssets = async (connectionId: string) => {
    setSyncing(connectionId);
    try {
      const result = await api<{ synced: number }>("/api/meta/oauth/assets/sync", {
        method: "POST",
        body: { organization_id: orgId, connection_id: connectionId },
      });
      toast.success(`${result.synced ?? 0} ativo(s) sincronizado(s)`);
      await loadState(orgId);
    } catch (e: any) {
      toast.error(e.message || "Não foi possível sincronizar ativos");
    } finally {
      setSyncing(null);
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl py-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Link2 className="h-6 w-6 text-primary" />
            Integrações Meta
          </h1>
          <p className="text-muted-foreground">
            Conecte as contas Meta da sua empresa: Página do Facebook (Messenger), Instagram Business e WhatsApp Business Cloud API.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/meta-lead-ads">Ver formulários e leads</Link></Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Conexão da conta</CardTitle>
            <CardDescription>
              A autorização é feita no login oficial do Facebook. Os ativos ficam isolados nesta organização.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="facebook" className="space-y-4">
              <TabsList>
                <TabsTrigger value="facebook">Facebook / Messenger</TabsTrigger>
                <TabsTrigger value="instagram">Instagram</TabsTrigger>
                <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              </TabsList>
              <TabsContent value="facebook">
                <ConnectCard
                  icon={Facebook}
                  title="Página do Facebook"
                  description="Conecte sua Página para Messenger e Lead Ads."
                  onConnect={() => startOAuth("facebook")}
                  loading={starting === "facebook"}
                />
              </TabsContent>
              <TabsContent value="instagram">
                <ConnectCard
                  icon={Instagram}
                  title="Instagram Business"
                  description="Conecte sua conta Instagram profissional vinculada a uma Página."
                  onConnect={() => startOAuth("instagram")}
                  loading={starting === "instagram"}
                />
              </TabsContent>
              <TabsContent value="whatsapp">
                <ConnectCard
                  icon={Phone}
                  title="WhatsApp Business"
                  description="Conecte seu número WhatsApp Business Cloud API."
                  onConnect={() => startOAuth("whatsapp")}
                  loading={starting === "whatsapp"}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Contas conectadas
              {orgId && (
                <Button size="sm" variant="ghost" onClick={() => loadState(orgId)} disabled={loading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
                </Button>
              )}
            </CardTitle>
            <CardDescription>Conexões OAuth e ativos sincronizados desta organização.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {connections.map((connection) => (
                <div key={connection.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium capitalize">{connection.provider}</p>
                    <p className="text-xs text-muted-foreground">
                      {connection.fb_user_id || "Conta Meta"} ·{" "}
                      {connection.token_expires_at
                        ? `expira em ${new Date(connection.token_expires_at).toLocaleDateString()}`
                        : "sem expiração informada"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => syncAssets(connection.id)} disabled={syncing === connection.id}>
                    {syncing === connection.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Sincronizar ativos
                  </Button>
                </div>
              ))}
              {connections.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma conta Meta conectada ainda nesta organização.</p>
              )}
            </div>

            {assets.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm gap-3">
                    <div>
                      <p className="font-medium">{asset.external_name || asset.external_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {kindLabel[asset.kind] || asset.kind} · {asset.status === "active" ? "ativo para integração" : "pausado"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={asset.status === "active" ? "outline" : "default"}
                      onClick={async () => {
                        try {
                          await toggleAsset(orgId, asset, asset.status !== "active");
                          await loadState(orgId);
                          toast.success(asset.status === "active" ? "Ativo pausado" : "Ativo habilitado");
                        } catch (e: any) {
                          toast.error(e.message || "Não foi possível alterar o ativo");
                        }
                      }}
                    >
                      {asset.status === "active" ? "Pausar" : "Habilitar"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function ConnectCard({
  icon: Icon,
  title,
  description,
  onConnect,
  loading,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  onConnect: () => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <p className="font-semibold">{title}</p>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button onClick={onConnect} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        Conectar com Facebook
      </Button>
    </div>
  );
}
