import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  Code,
  ClipboardList,
  FileSignature,
  FileText,
  Facebook,
  GitBranch,
  Kanban,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  Plug,
  Receipt,
  RefreshCw,
  Send,
  Settings,
  Shield,
  Sparkles,
  User,
  Users,
  UserPlus,
  Zap,
  Bell,
  Lock,
  Webhook,
  Ghost,
  FolderKanban,
  BarChart4,
  Video,
  Target as TargetIcon,
} from "lucide-react";
import { API_URL, getAuthToken } from "@/lib/api";
import gleegoLogo from "@/assets/gleego-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/hooks/use-branding";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  pageKey?: string; // Used for permission template matching
  moduleKey?: 'campaigns' | 'billing' | 'groups' | 'scheduled_messages' | 'chatbots' | 'chat' | 'crm' | 'ai_agents' | 'group_secretary' | 'ghost' | 'projects' | 'lead_gleego' | 'doc_signatures';
  adminOnly?: boolean;
  ownerOnly?: boolean;
  superadminOnly?: boolean;
}

interface NavSection {
  title: string;
  icon: any;
  items: NavItem[];
  moduleKey?: 'campaigns' | 'billing' | 'groups' | 'scheduled_messages' | 'chatbots' | 'chat' | 'crm' | 'ai_agents' | 'group_secretary' | 'ghost' | 'projects' | 'lead_gleego' | 'doc_signatures';
  adminOnly?: boolean; // Entire section requires admin role
}

const getNavSections = (hasConnections: boolean): NavSection[] => [
  {
    title: "Atendimento",
    icon: MessagesSquare,
    items: [
      ...(hasConnections ? [{ name: "Chat", href: "/chat", icon: MessagesSquare, pageKey: 'chat', moduleKey: 'chat' as const }] : []),
      ...(hasConnections ? [{ name: "Secretária IA", href: "/secretaria-grupos", icon: Bot, pageKey: 'secretaria_ia', moduleKey: 'group_secretary' as const, adminOnly: true }] : []),
      { name: "Agentes IA", href: "/agentes-ia", icon: Sparkles, pageKey: 'agentes_ia', moduleKey: 'ai_agents' as const },
      { name: "IA Assistentes", href: "/agentes-ia-cliente", icon: Bot, pageKey: 'ia_assistentes', moduleKey: 'ai_agents' as const },
      { name: "Auto-Resposta", href: "/agentes-modos", icon: Sparkles, pageKey: 'agentes_modos', moduleKey: 'ai_agents' as const },
      ...(hasConnections ? [{ name: "Chatbots", href: "/chatbots", icon: Bot, pageKey: 'chatbots', moduleKey: 'chatbots' as const, adminOnly: true }] : []),
      ...(hasConnections ? [{ name: "Fluxos", href: "/fluxos", icon: GitBranch, pageKey: 'fluxos', moduleKey: 'chatbots' as const, adminOnly: true }] : []),
      { name: "Departamentos", href: "/departamentos", icon: Building2, pageKey: 'departamentos', adminOnly: true },
      { name: "Agendamentos", href: "/agendamentos", icon: Bell, pageKey: 'agendamentos', moduleKey: 'scheduled_messages' as const },
      { name: "Respostas Rápidas", href: "/respostas-rapidas", icon: MessageSquare, pageKey: 'respostas_rapidas' },
      { name: "Tags", href: "/tags", icon: Receipt, pageKey: 'tags' },
      { name: "Contatos", href: "/contatos-chat", icon: Users, pageKey: 'contatos' },
    ],
  },
  {
    title: "CRM",
    icon: Briefcase,
    moduleKey: 'crm',
    items: [
      { name: "Negociações", href: "/crm/negociacoes", icon: Kanban, pageKey: 'crm_negociacoes' },
      { name: "Prospects", href: "/crm/prospects", icon: UserPlus, pageKey: 'crm_prospects' },
      { name: "Empresas", href: "/crm/empresas", icon: Building2, pageKey: 'crm_empresas' },
      { name: "Projetos", href: "/projetos", icon: FolderKanban, pageKey: 'projetos', moduleKey: 'projects' },
      { name: "Mapa", href: "/mapa", icon: Map, pageKey: 'mapa' },
      { name: "Agenda", href: "/crm/agenda", icon: CalendarDays, pageKey: 'crm_agenda' },
      { name: "Tarefas", href: "/tarefas", icon: ClipboardList, pageKey: 'crm_tarefas' },
      { name: "Relatórios", href: "/crm/relatorios", icon: BarChart3, pageKey: 'crm_relatorios' },
      { name: "Revenue Intel", href: "/revenue-intelligence", icon: Brain, pageKey: 'revenue_intelligence', adminOnly: true },
      { name: "Fantasma", href: "/modulo-fantasma", icon: Ghost, pageKey: 'modulo_fantasma', ownerOnly: true, moduleKey: 'ghost' },
      { name: "Workspace Dev", href: "/workspace", icon: Code, pageKey: 'workspace_dev', ownerOnly: true },
      { name: "Análise SEO e Vendas", href: "/sales-seo", icon: TargetIcon, pageKey: 'sales_seo', adminOnly: true },
      { name: "Supervisor IA", href: "/supervisor-ia", icon: Shield, pageKey: 'supervisor_ia', adminOnly: true },
      { name: "Configurações", href: "/crm/configuracoes", icon: Settings, pageKey: 'crm_configuracoes', adminOnly: true },

    ],
  },
  {
    title: "Disparos",
    icon: Send,
    moduleKey: 'campaigns',
    items: [
      { name: "Listas", href: "/contatos", icon: Users, pageKey: 'listas' },
      { name: "Mensagens", href: "/mensagens", icon: MessageSquare, pageKey: 'mensagens' },
      { name: "Campanhas", href: "/campanhas", icon: Send, pageKey: 'campanhas' },
      { name: "Sequências", href: "/sequencias", icon: RefreshCw, pageKey: 'sequencias', adminOnly: true },
      { name: "Fluxos Externos", href: "/fluxos-externos", icon: FileText, pageKey: 'fluxos_externos', adminOnly: true },
      { name: "Meta Lead Ads", href: "/meta-lead-ads", icon: Facebook, pageKey: 'meta_lead_ads', adminOnly: true },
      { name: "Webhooks", href: "/lead-webhooks", icon: Webhook, pageKey: 'webhooks', adminOnly: true },
      { name: "API Integração", href: "/api-docs", icon: Code, pageKey: 'api_docs', adminOnly: true },
      { name: "CTWA Analytics", href: "/ctwa-analytics", icon: MousePointerClick, pageKey: 'ctwa_analytics', adminOnly: true },
      { name: "Lead Gleego", href: "/lead-gleego", icon: BarChart4, pageKey: 'lead_gleego', moduleKey: 'lead_gleego' as const },
    ],
  },
  {
    title: "Teleatendimento",
    icon: Video,
    items: [
      { name: "Sessões", href: "/teleatendimento", icon: Video, pageKey: 'teleatendimento' },
    ],
  },
  {
    title: "Minha Conta",
    icon: User,
    items: [
      { name: "Conexões", href: "/conexao", icon: Plug, pageKey: 'conexoes' },
      { name: "Templates Meta", href: "/meta-templates", icon: FileText, pageKey: 'meta_templates' },
      { name: "Assinaturas", href: "/assinaturas", icon: FileSignature, pageKey: 'assinaturas', moduleKey: 'doc_signatures' as const },
      { name: "Ajustes", href: "/configuracoes", icon: Settings, pageKey: 'ajustes' },
    ],
  },
  {
    title: "Administração",
    icon: Shield,
    adminOnly: true,
    items: [
      { name: "Cobrança", href: "/cobranca", icon: Receipt, pageKey: 'cobranca', moduleKey: 'billing' },
      { name: "Organizações", href: "/organizacoes", icon: Building2, pageKey: 'organizacoes' },
    ],
  },
];

interface SidebarContentProps {
  isExpanded: boolean;
  isSuperadmin: boolean;
  onNavigate?: () => void;
}

function SidebarContentComponent({ isExpanded, isSuperadmin, onNavigate }: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user, modulesEnabled, pagePermissions } = useAuth();
  const { branding } = useBranding();
  const [openSections, setOpenSections] = useState<string[]>(["Atendimento"]);

  // Helper to check if user has admin-level role
  const isAdminRole = (role?: string) => ['owner', 'admin', 'manager', 'supervisor'].includes(role || '');
  const isOwnerRole = (role?: string) => role === 'owner';
  const userIsAdmin = isSuperadmin || isAdminRole(user?.role);
  const userIsOwner = isSuperadmin || isOwnerRole(user?.role);
  const hasConnections = user?.has_connections !== false; // default true if undefined
  const hasTemplate = !!pagePermissions; // User has a permission template assigned

  const navSections = getNavSections(hasConnections);

  // Filter sections and items based on modules enabled, role, AND permission template
  const filteredSections = navSections
    .filter(section => {
      // Check module access
      if (section.moduleKey && !modulesEnabled[section.moduleKey] && !isSuperadmin) return false;
      // If user has a permission template, don't filter by adminOnly for sections
      if (!hasTemplate) {
        if (section.adminOnly && !userIsAdmin) return false;
      }
      return true;
    })
    .map(section => ({
      ...section,
      items: section.items.filter(item => {
        // Check module access
        if (item.moduleKey && !modulesEnabled[item.moduleKey] && !isSuperadmin) return false;
        // Check superadmin-only item (always requires superadmin)
        if (item.superadminOnly && !isSuperadmin) return false;
        
        // If user has a permission template, use it instead of role-based checks
        if (hasTemplate && item.pageKey) {
          // Template explicitly controls access - if key exists, use its value; if not in template, deny
          return pagePermissions[item.pageKey] === true;
        }
        
        // Fallback to role-based checks when no template
        if (item.adminOnly && !userIsAdmin) return false;
        if (item.ownerOnly && !userIsOwner) return false;
        return true;
      })
    }))
    .filter(section => section.items.length > 0);

  const handleLogout = () => {
    logout();
    navigate("/login");
    onNavigate?.();
  };

  const toggleSection = (title: string) => {
    setOpenSections(prev =>
      prev.includes(title)
        ? prev.filter(s => s !== title)
        : [...prev, title]
    );
  };

  const isActiveRoute = (href: string) => location.pathname === href;

  const isSectionActive = (section: NavSection) =>
    section.items.some(item => isActiveRoute(item.href));

  const renderNavItem = (item: NavItem, indent = false) => {
    const isActive = isActiveRoute(item.href);
    
    const linkContent = (
      <Link
        key={item.name}
        to={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          indent && isExpanded && "ml-4",
          isExpanded ? "" : "justify-center",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
        {isExpanded && <span className="whitespace-nowrap">{item.name}</span>}
      </Link>
    );

    if (!isExpanded) {
      return (
        <Tooltip key={item.name} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {item.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 items-center gap-3 border-b border-border transition-all duration-300",
          isExpanded ? "px-6" : "px-3 justify-center"
        )}
      >
        {branding.logo_sidebar ? (
          <img 
            src={branding.logo_sidebar} 
            alt="Logo" 
            className="h-10 w-10 object-contain shrink-0 rounded-xl"
          />
        ) : (
          <img src={gleegoLogo} alt="Glee-go Whats" className="h-10 w-10 object-contain shrink-0 rounded-xl" />
        )}
        {isExpanded && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold text-foreground whitespace-nowrap">Glee-go Whats</h1>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Gestão Comercial</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto scrollbar-none hover:scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {/* Dashboard - always visible */}
        {renderNavItem({ name: "Dashboard", href: "/dashboard", icon: LayoutDashboard })}

        {/* Sections */}
        {filteredSections.map((section) => {
          const isOpen = openSections.includes(section.title);
          const sectionActive = isSectionActive(section);

          if (!isExpanded) {
            // When collapsed, show items directly with tooltips
            return (
              <div key={section.title} className="space-y-1 pt-2">
                {section.items.map(item => renderNavItem(item))}
              </div>
            );
          }

          return (
            <Collapsible
              key={section.title}
              open={isOpen}
              onOpenChange={() => toggleSection(section.title)}
              className="pt-2"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors">
                <div className="flex items-center gap-3">
                  <section.icon className={cn("h-4 w-4", sectionActive && "text-primary")} />
                  <span>{section.title}</span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1 data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
                {section.items.map((item, index) => (
                  <div 
                    key={item.name}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {renderNavItem(item, true)}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}

        {/* Superadmin Link */}
        {isSuperadmin && (
          <>
            {!isExpanded ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to="/admin"
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 mt-4 border border-primary/30",
                      location.pathname === "/admin"
                        ? "bg-primary/20 text-primary neon-glow"
                        : "text-primary hover:bg-primary/10"
                    )}
                  >
                    <Shield className="h-5 w-5 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  Superadmin
                </TooltipContent>
              </Tooltip>
            ) : (
              <Link
                to="/admin"
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 mt-4 border border-primary/30",
                  location.pathname === "/admin"
                    ? "bg-primary/20 text-primary neon-glow"
                    : "text-primary hover:bg-primary/10"
                )}
              >
                <Shield className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">Superadmin</span>
              </Link>
            )}
          </>
        )}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-border p-3 space-y-2",
          !isExpanded && "flex flex-col items-center"
        )}
      >
        {user && isExpanded && (
          <div className="rounded-lg bg-accent/50 p-3">
            <p className="text-xs font-medium text-accent-foreground truncate">
              {user.name || user.email}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}

        {!isExpanded ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center rounded-lg p-2.5 text-destructive hover:bg-destructive/10 transition-all duration-200"
              >
                <LogOut className="h-5 w-5 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              Sair
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-all duration-200"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap">Sair</span>
          </button>
        )}

        {isExpanded && (
          <div className="text-center space-y-0.5">
            <p className="text-xs font-medium text-primary">TNS R2D2</p>
            <p className="text-xs text-muted-foreground">Versão 1.0.0</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    checkSuperadmin();
  }, []);

  const checkSuperadmin = async () => {
    try {
      const token = getAuthToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/admin/check`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setIsSuperadmin(data.isSuperadmin);
      }
    } catch {
      setIsSuperadmin(false);
    }
  };

  const collapsedWidth = "w-16";
  const expandedWidth = "w-64";

  return (
    <>
      {/* Mobile/Tablet Menu Button - visible until xl breakpoint */}
      <div className="fixed top-14 left-3 z-[80] xl:hidden" style={{ isolation: 'isolate' }}>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-10 w-10 bg-card border-border shadow-xl rounded-full ring-2 ring-background"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 bg-card border-border z-[70]">
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <SidebarContentComponent
              isExpanded={true}
              isSuperadmin={isSuperadmin}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen bg-card border-r border-border shadow-card transition-all duration-300 ease-in-out hidden xl:block",
          isHovered ? expandedWidth : collapsedWidth
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <SidebarContentComponent isExpanded={isHovered} isSuperadmin={isSuperadmin} />
      </aside>
    </>
  );
}

export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_EXPANDED_WIDTH = 256;
