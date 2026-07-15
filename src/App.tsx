import { useEffect } from "react";
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
import Index from "./pages/Index";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import Conexao from "./pages/Conexao";
import Contatos from "./pages/Contatos";
import Mensagens from "./pages/Mensagens";
import Campanhas from "./pages/Campanhas";
import Chat from "./pages/Chat";
import Cobranca from "./pages/Cobranca";
import Organizacoes from "./pages/Organizacoes";
import Admin from "./pages/Admin";
import AdminMetaSaas from "./pages/AdminMetaSaas";
import MetaConnect from "./pages/MetaConnect";
import MetaLeadAds from "./pages/MetaLeadAds";
import MetaOnboarding from "./pages/MetaOnboarding";
import Configuracoes from "./pages/Configuracoes";
import Agendamentos from "./pages/Agendamentos";
import Tags from "./pages/Tags";
import ContatosChat from "./pages/ContatosChat";
import Chatbots from "./pages/Chatbots";
import Fluxos from "./pages/Fluxos";
import Departamentos from "./pages/Departamentos";
import AgentesIA from "./pages/AgentesIA";
import CRMNegociacoes from "./pages/CRMNegociacoes";
import CRMProspects from "./pages/CRMProspects";
import CRMEmpresas from "./pages/CRMEmpresas";
import CRMTarefas from "./pages/CRMTarefas";
import CRMAgenda from "./pages/CRMAgenda";
import CRMConfiguracoes from "./pages/CRMConfiguracoes";
import CRMRelatorios from "./pages/CRMRelatorios";
import Mapa from "./pages/Mapa";
import PoliticaPrivacidade from "./pages/PoliticaPrivacidade";
import TermosServico from "./pages/TermosServico";
import ExclusaoDados from "./pages/ExclusaoDados";
import FluxosExternos from "./pages/FluxosExternos";
import PublicFormPage from "./pages/PublicFormPage";
import LeadWebhooks from "./pages/LeadWebhooks";
import SequenciasNurturing from "./pages/SequenciasNurturing";
import CTWAAnalytics from "./pages/CTWAAnalytics";
import RevenueIntelligence from "./pages/RevenueIntelligence";
import SecretariaGrupos from "./pages/SecretariaGrupos";
import ModuloFantasma from "./pages/ModuloFantasma";
import SalesSEOAnalytics from "./pages/SalesSEOAnalytics";
import Projetos from "./pages/Projetos";
import TarefasKanban from "./pages/TarefasKanban";
import LeadGleego from "./pages/LeadGleego";
import AgentesIACliente from "./pages/AgentesIACliente";
import AgentesModos from "./pages/AgentesModos";
import RespostasRapidas from "./pages/RespostasRapidas";
import ApiDocumentation from "./pages/ApiDocumentation";
import MetaTemplates from "./pages/MetaTemplates";
import Assinaturas from "./pages/Assinaturas";
import AssinarDocumento from "./pages/AssinarDocumento";
import VerificarDocumento from "./pages/VerificarDocumento";
import Teleatendimento from "./pages/Teleatendimento";
import SupervisorIA from "./pages/SupervisorIA";
import MarinaTestChat from "./pages/MarinaTestChat";
import MinhaEquipe from "./pages/MinhaEquipe";

import NotFound from "./pages/NotFound";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <FaviconUpdater />
      <PWAUpdateBanner />
      <BrowserRouter>
        <AuthProvider>
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
