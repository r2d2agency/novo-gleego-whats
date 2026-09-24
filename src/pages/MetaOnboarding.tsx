import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Facebook, Instagram, MessageCircle, Phone, ShieldCheck, Sparkles, CheckCircle2,
  ArrowRight, ArrowLeft, Loader2, ExternalLink, RefreshCw, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMetaPages } from "@/hooks/use-meta-lead-ads";

const META_SAAS_ENABLED = import.meta.env.VITE_META_SAAS_ENABLED === "true";
const STORAGE_KEY = "meta_onboarding_step";

type StepId = "welcome" | "connect" | "review" | "leadads" | "done";

const STEPS: { id: StepId; label: string }[] = [
  { id: "welcome",  label: "Boas-vindas" },
  { id: "connect",  label: "Conectar Meta" },
  { id: "review",   label: "Revisar ativos" },
  { id: "leadads",  label: "Lead Ads" },
  { id: "done",     label: "Concluído" },
];

export default function MetaOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const pages = useMetaPages(orgId || null);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      const idx = STEPS.findIndex((s) => s.id === saved);
      if (idx >= 0) setStepIndex(idx);
    }
    setOrgId(user?.organization_id || sessionStorage.getItem("user_org_id") || "");
  }, [user]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, STEPS[stepIndex].id);
  }, [stepIndex]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("meta") === "ok") {
      setStepIndex(STEPS.findIndex((s) => s.id === "review"));
      toast.success("Conta Meta conectada!");
      url.searchParams.delete("meta");
      window.history.replaceState({}, "", url.toString());
      pages.refetch?.();
    }
  }, []); // eslint-disable-line

  const current = STEPS[stepIndex];
  const progress = useMemo(() => ((stepIndex + 1) / STEPS.length) * 100, [stepIndex]);

  const startOAuth = async (provider: "facebook" | "instagram" | "whatsapp") => {
    if (!orgId) { toast.error("Organização não identificada."); return; }
    if (!META_SAAS_ENABLED) {
      toast.info("Conexão simplificada ainda em desenvolvimento. Fale com o suporte da Gleego.");
      return;
    }
    setConnecting(provider);
    try {
      const data = await api<{ url: string }>("/api/meta/oauth/start", {
        method: "POST",
        body: {
          provider,
          organization_id: orgId,
          redirect_uri: `${window.location.origin}/onboarding-meta?meta=ok`,
        },
      });
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      toast.error(e?.message || "Erro ao iniciar conexão");
    } finally {
      setConnecting(null);
    }
  };

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const prev = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <MainLayout>
      <div className="container mx-auto max-w-3xl py-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Configuração guiada Meta
            </h1>
            <Badge variant="outline">{stepIndex + 1} / {STEPS.length}</Badge>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex flex-wrap gap-1.5 text-xs">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i <= stepIndex && setStepIndex(i)}
                className={`px-2 py-1 rounded-full border transition ${
                  i === stepIndex
                    ? "bg-primary text-primary-foreground border-primary"
                    : i < stepIndex
                      ? "bg-primary/10 text-primary border-primary/40 cursor-pointer"
                      : "bg-muted text-muted-foreground border-transparent cursor-default"
                }`}
              >
                {i < stepIndex && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                {s.label}
              </button>
            ))}
          </div>
        </header>

        {!META_SAAS_ENABLED && current.id !== "welcome" && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Em desenvolvimento</AlertTitle>
            <AlertDescription>
              A conexão automática ainda está em revisão pela Meta. Esta tela já é o fluxo real —
              assim que liberado, basta clicar em "Conectar com Facebook".
            </AlertDescription>
          </Alert>
        )}

        {current.id === "welcome" && (
          <Card>
            <CardHeader>
              <CardTitle>Vamos conectar suas contas Meta à Gleego</CardTitle>
              <CardDescription>
                Em 4 passos rápidos você terá WhatsApp Business, Página do Facebook,
                Instagram Direct e formulários Lead Ads enviando direto para o seu CRM.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { icon: Phone, t: "WhatsApp Business Cloud", d: "Atendimento via API oficial." },
                { icon: Facebook, t: "Página do Facebook", d: "Mensagens do Messenger no mesmo painel." },
                { icon: Instagram, t: "Instagram Direct", d: "DMs da sua conta Business." },
                { icon: MessageCircle, t: "Lead Ads", d: "Leads do Facebook caem direto no CRM." },
              ].map(({ icon: Icon, t, d }) => (
                <div key={t} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t}</p>
                    <p className="text-sm text-muted-foreground">{d}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/50 p-3">
                <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  A Gleego nunca vê sua senha. Você autoriza diretamente no Facebook e pode revogar
                  a qualquer momento em <em>Configurações &gt; Apps conectados</em>.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {current.id === "connect" && (
          <Card>
            <CardHeader>
              <CardTitle>Conectar com Facebook</CardTitle>
              <CardDescription>
                Use a conta que administra sua Página, Instagram Business e/ou WhatsApp Business.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                size="lg"
                className="w-full gap-2"
                onClick={() => startOAuth("facebook")}
                disabled={connecting !== null}
              >
                {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Facebook className="h-5 w-5" />}
                Conectar com Facebook
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="gap-2" onClick={() => startOAuth("whatsapp")} disabled={connecting !== null}>
                  <Phone className="h-4 w-4" /> Só WhatsApp
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => startOAuth("instagram")} disabled={connecting !== null}>
                  <Instagram className="h-4 w-4" /> Só Instagram
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Você será redirecionado ao Facebook. Após autorizar, voltamos automaticamente para o próximo passo.
              </p>
            </CardContent>
          </Card>
        )}

        {current.id === "review" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Revisar ativos conectados</span>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => pages.refetch?.()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                </Button>
              </CardTitle>
              <CardDescription>Confira o que ficou disponível na sua conta Gleego.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pages.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : (pages.data?.length ?? 0) === 0 ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Nenhuma página detectada</AlertTitle>
                  <AlertDescription>
                    Volte ao passo anterior e tente conectar novamente, ou fale com o suporte
                    se você não administra nenhuma Página/IG/WABA.
                  </AlertDescription>
                </Alert>
              ) : (
                pages.data!.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                        <Facebook className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{p.external_name || p.external_id}</p>
                        <p className="text-xs text-muted-foreground truncate">ID: {p.external_id}</p>
                      </div>
                    </div>
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {current.id === "leadads" && (
          <Card>
            <CardHeader>
              <CardTitle>Ativar formulários Lead Ads</CardTitle>
              <CardDescription>
                Cada formulário que você usa no Gerenciador de Anúncios pode cair direto no CRM.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="list-decimal list-inside text-sm space-y-1.5 text-muted-foreground">
                <li>Abra <strong>Campanhas &rarr; Meta Lead Ads</strong>.</li>
                <li>Clique em <strong>Sincronizar</strong> na página conectada.</li>
                <li>Em cada formulário, escolha funil, responsável e (opcional) conexão WhatsApp para abrir conversa.</li>
              </ol>
              <Button className="gap-2" onClick={() => navigate("/meta-lead-ads")}>
                Ir para Meta Lead Ads <ExternalLink className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {current.id === "done" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" /> Tudo pronto!
              </CardTitle>
              <CardDescription>
                Sua integração Meta está ativa. Você pode reabrir este assistente a qualquer momento.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => navigate("/chat")}>Ir para o Chat</Button>
              <Button variant="outline" onClick={() => navigate("/meta-lead-ads")}>Ver Lead Ads</Button>
              <Button variant="outline" onClick={() => navigate("/crm-prospects")}>Abrir CRM</Button>
              <Button onClick={() => { sessionStorage.removeItem(STORAGE_KEY); setStepIndex(0); }}>
                Reiniciar assistente
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={prev} disabled={stepIndex === 0} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          {stepIndex < STEPS.length - 1 && (
            <Button onClick={next} className="gap-2">
              Próximo <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </MainLayout>
  );
}