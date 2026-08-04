import { lazy, Suspense, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useBranding } from "@/hooks/use-branding";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PWAUpdateBanner } from "@/components/layout/PWAUpdateBanner";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";

const Index = lazy(() => import("./pages/Index"));
const Cadastro = lazy(() => import("./pages/Cadastro"));
const Conexao = lazy(() => import("./pages/Conexao"));
const Contatos = lazy(() => import("./pages/Contatos"));
const Mensagens = lazy(() => import("./pages/Mensagens"));
const Campanhas = lazy(() => import("./pages/Campanhas"));
const Chat = lazy(() => import("./pages/Chat"));
const Cobranca = lazy(() => import("./pages/Cobranca"));
const Organizacoes = lazy(() => import("./pages/Organizacoes"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminMetaSaas = lazy(() => import("./pages/AdminMetaSaas"));
const MetaConnect = lazy(() => import("./pages/MetaConnect"));
const MetaLeadAds = lazy(() => import("./pages/MetaLeadAds"));
const MetaOnboarding = lazy(() => import("./pages/MetaOnboarding"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const Agendamentos = lazy(() => import("./pages/Agendamentos"));
const Tags = lazy(() => import("./pages/Tags"));
const ContatosChat = lazy(() => import("./pages/ContatosChat"));
const Chatbots = lazy(() => import("./pages/Chatbots"));
const Fluxos = lazy(() => import("./pages/Fluxos"));
const Departamentos = lazy(() => import("./pages/Departamentos"));
const AgentesIA = lazy(() => import("./pages/AgentesIA"));
const CRMNegociacoes = lazy(() => import("./pages/CRMNegociacoes"));
const CRMProspects = lazy(() => import("./pages/CRMProspects"));
const CRMEmpresas = lazy(() => import("./pages/CRMEmpresas"));
const CRMTarefas = lazy(() => import("./pages/CRMTarefas"));
const CRMAgenda = lazy(() => import("./pages/CRMAgenda"));
const CRMConfiguracoes = lazy(() => import("./pages/CRMConfiguracoes"));
const CRMRelatorios = lazy(() => import("./pages/CRMRelatorios"));
const Mapa = lazy(() => import("./pages/Mapa"));
const PoliticaPrivacidade = lazy(() => import("./pages/PoliticaPrivacidade"));
const TermosServico = lazy(() => import("./pages/TermosServico"));
const ExclusaoDados = lazy(() => import("./pages/ExclusaoDados"));
const FluxosExternos = lazy(() => import("./pages/FluxosExternos"));
const PublicFormPage = lazy(() => import("./pages/PublicFormPage"));
const LeadWebhooks = lazy(() => import("./pages/LeadWebhooks"));
const SequenciasNurturing = lazy(() => import("./pages/SequenciasNurturing"));
const CTWAAnalytics = lazy(() => import("./pages/CTWAAnalytics"));
const RevenueIntelligence = lazy(() => import("./pages/RevenueIntelligence"));
const SecretariaGrupos = lazy(() => import("./pages/SecretariaGrupos"));
const ModuloFantasma = lazy(() => import("./pages/ModuloFantasma"));
const SalesSEOAnalytics = lazy(() => import("./pages/SalesSEOAnalytics"));
const Projetos = lazy(() => import("./pages/Projetos"));
const TarefasKanban = lazy(() => import("./pages/TarefasKanban"));
const LeadGleego = lazy(() => import("./pages/LeadGleego"));
const AgentesIACliente = lazy(() => import("./pages/AgentesIACliente"));
const AgentesModos = lazy(() => import("./pages/AgentesModos"));
const RespostasRapidas = lazy(() => import("./pages/RespostasRapidas"));
const ApiDocumentation = lazy(() => import("./pages/ApiDocumentation"));
const MetaTemplates = lazy(() => import("./pages/MetaTemplates"));
const Assinaturas = lazy(() => import("./pages/Assinaturas"));
const AssinarDocumento = lazy(() => import("./pages/AssinarDocumento"));
const VerificarDocumento = lazy(() => import("./pages/VerificarDocumento"));
const Teleatendimento = lazy(() => import("./pages/Teleatendimento"));
const SupervisorIA = lazy(() => import("./pages/SupervisorIA"));
const MarinaTestChat = lazy(() => import("./pages/MarinaTestChat"));
const MinhaEquipe = lazy(() => import("./pages/MinhaEquipe"));
const WorkspaceHome = lazy(() => import("./pages/workspace/WorkspaceHome"));
const WorkspaceProject = lazy(() => import("./pages/workspace/WorkspaceProject"));
const ClientPortal = lazy(() => import("./pages/workspace/ClientPortal"));
const WorkspaceKanban = lazy(() => import("./pages/workspace/WorkspaceKanban"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// Component to handle favicon update
function FaviconUpdater() {
  const { branding } = useBranding();

  useEffect(() => {
    if (branding.favicon) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) {
        link.href = branding.favicon;
      } else {
        const newLink = document.createElement('link');
        newLink.rel = 'icon';
        newLink.href = branding.favicon;
        document.head.appendChild(newLink);
      }
    }
  }, [branding.favicon]);

  return null;
}

// Smart redirect: logged in → dashboard, not logged in → login (PWA/mobile skip landing)
function SmartRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (isPWA) return <Navigate to="/login" replace />;
  return <LandingPage />;
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <FaviconUpdater />
      <PWAUpdateBanner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/" element={<SmartRedirect />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/conexao" element={<ProtectedRoute><Conexao /></ProtectedRoute>} />
            <Route path="/contatos" element={<ProtectedRoute><Contatos /></ProtectedRoute>} />
            <Route path="/mensagens" element={<ProtectedRoute><Mensagens /></ProtectedRoute>} />
            <Route path="/campanhas" element={<ProtectedRoute><Campanhas /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/agendamentos" element={<ProtectedRoute><Agendamentos /></ProtectedRoute>} />
            <Route path="/tags" element={<ProtectedRoute><Tags /></ProtectedRoute>} />
            <Route path="/contatos-chat" element={<ProtectedRoute><ContatosChat /></ProtectedRoute>} />
            <Route path="/cobranca" element={<ProtectedRoute><Cobranca /></ProtectedRoute>} />
            <Route path="/organizacoes" element={<ProtectedRoute><Organizacoes /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/admin/meta-saas" element={<ProtectedRoute><AdminMetaSaas /></ProtectedRoute>} />
            <Route path="/conectar-meta" element={<ProtectedRoute><MetaConnect /></ProtectedRoute>} />
            <Route path="/meta-lead-ads" element={<ProtectedRoute><MetaLeadAds /></ProtectedRoute>} />
            <Route path="/onboarding-meta" element={<ProtectedRoute><MetaOnboarding /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
            <Route path="/chatbots" element={<ProtectedRoute><Chatbots /></ProtectedRoute>} />
            <Route path="/fluxos" element={<ProtectedRoute><Fluxos /></ProtectedRoute>} />
            <Route path="/departamentos" element={<ProtectedRoute><Departamentos /></ProtectedRoute>} />
            <Route path="/agentes-ia" element={<ProtectedRoute><AgentesIA /></ProtectedRoute>} />
            <Route path="/crm/negociacoes" element={<ProtectedRoute><CRMNegociacoes /></ProtectedRoute>} />
            <Route path="/crm/prospects" element={<ProtectedRoute><CRMProspects /></ProtectedRoute>} />
            <Route path="/crm/empresas" element={<ProtectedRoute><CRMEmpresas /></ProtectedRoute>} />
            <Route path="/crm/tarefas" element={<ProtectedRoute><CRMTarefas /></ProtectedRoute>} />
            <Route path="/crm/agenda" element={<ProtectedRoute><CRMAgenda /></ProtectedRoute>} />
            <Route path="/crm/configuracoes" element={<ProtectedRoute><CRMConfiguracoes /></ProtectedRoute>} />
            <Route path="/crm/relatorios" element={<ProtectedRoute><CRMRelatorios /></ProtectedRoute>} />
            <Route path="/mapa" element={<ProtectedRoute><Mapa /></ProtectedRoute>} />
            <Route path="/fluxos-externos" element={<ProtectedRoute><FluxosExternos /></ProtectedRoute>} />
            <Route path="/lead-webhooks" element={<ProtectedRoute><LeadWebhooks /></ProtectedRoute>} />
            <Route path="/sequencias" element={<ProtectedRoute><SequenciasNurturing /></ProtectedRoute>} />
            <Route path="/ctwa-analytics" element={<ProtectedRoute><CTWAAnalytics /></ProtectedRoute>} />
            <Route path="/revenue-intelligence" element={<ProtectedRoute><RevenueIntelligence /></ProtectedRoute>} />
            <Route path="/secretaria-grupos" element={<ProtectedRoute><SecretariaGrupos /></ProtectedRoute>} />
            <Route path="/modulo-fantasma" element={<ProtectedRoute><ModuloFantasma /></ProtectedRoute>} />
            <Route path="/sales-seo" element={<ProtectedRoute><SalesSEOAnalytics /></ProtectedRoute>} />
            <Route path="/projetos" element={<ProtectedRoute><Projetos /></ProtectedRoute>} />
            <Route path="/tarefas" element={<ProtectedRoute><TarefasKanban /></ProtectedRoute>} />
            <Route path="/lead-gleego" element={<ProtectedRoute><LeadGleego /></ProtectedRoute>} />
            <Route path="/agentes-ia-cliente" element={<ProtectedRoute><AgentesIACliente /></ProtectedRoute>} />
            <Route path="/agentes-modos" element={<ProtectedRoute><AgentesModos /></ProtectedRoute>} />
            <Route path="/respostas-rapidas" element={<ProtectedRoute><RespostasRapidas /></ProtectedRoute>} />
            <Route path="/meta-templates" element={<ProtectedRoute><MetaTemplates /></ProtectedRoute>} />
            <Route path="/assinaturas" element={<ProtectedRoute><Assinaturas /></ProtectedRoute>} />
            <Route path="/teleatendimento" element={<ProtectedRoute><Teleatendimento /></ProtectedRoute>} />
            <Route path="/supervisor-ia" element={<ProtectedRoute><SupervisorIA /></ProtectedRoute>} />
            <Route path="/minha-equipe" element={<ProtectedRoute><MinhaEquipe /></ProtectedRoute>} />
            <Route path="/workspace" element={<ProtectedRoute><WorkspaceHome /></ProtectedRoute>} />
            <Route path="/workspace/kanban" element={<ProtectedRoute><WorkspaceKanban /></ProtectedRoute>} />
            <Route path="/workspace/:id" element={<ProtectedRoute><WorkspaceProject /></ProtectedRoute>} />
            <Route path="/p/:token" element={<ClientPortal />} />
            <Route path="/testbarber" element={<ProtectedRoute><MarinaTestChat /></ProtectedRoute>} />

            <Route path="/marina-test" element={<ProtectedRoute><MarinaTestChat /></ProtectedRoute>} />
            <Route path="/api-docs" element={<ApiDocumentation />} />
            <Route path="/f/:slug" element={<PublicFormPage />} />
            <Route path="/assinar/:token" element={<AssinarDocumento />} />
            <Route path="/verificar/:documentId" element={<VerificarDocumento />} />
            <Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
            <Route path="/termos-servico" element={<TermosServico />} />
            <Route path="/exclusao-dados" element={<ExclusaoDados />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
