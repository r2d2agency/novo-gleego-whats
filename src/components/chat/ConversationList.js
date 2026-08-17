import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { Search, Archive, Tag, MessageSquare, Image, Mic, FileText, Video, RefreshCw, Loader2, UserCheck, MoreVertical, Trash2, Sparkles, Plus, CheckCircle, Clock, CheckCheck, RotateCcw, SearchCode, Users, Building2, Smartphone, BellOff, Bell, Pin, Star, Zap, } from "lucide-react";
import { formatDistanceToNow, format, subDays, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { SwipeableConversationItem } from "./SwipeableConversationItem";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// Predefined color palette for connection indicators
const CONNECTION_COLORS = [
    'hsl(142, 71%, 45%)', // green
    'hsl(217, 91%, 60%)', // blue
    'hsl(47, 100%, 50%)', // amber
    'hsl(280, 68%, 60%)', // purple
    'hsl(0, 84%, 60%)', // red
    'hsl(187, 85%, 43%)', // cyan
    'hsl(25, 95%, 53%)', // orange
    'hsl(330, 81%, 60%)', // pink
];
function getConnectionColor(connectionId, connections) {
    if (!connections || connections.length <= 1 || !connectionId)
        return null;
    const idx = connections.findIndex(c => c.id === connectionId);
    return CONNECTION_COLORS[idx >= 0 ? idx % CONNECTION_COLORS.length : 0];
}
const getMessageTypeIcon = (type) => {
    switch (type) {
        case 'image':
            return <Image className="h-3 w-3"/>;
        case 'audio':
            return <Mic className="h-3 w-3"/>;
        case 'video':
            return <Video className="h-3 w-3"/>;
        case 'document':
            return <FileText className="h-3 w-3"/>;
        default:
            return null;
    }
};
const getMessagePreview = (message, type) => {
    if (!message && type === 'image')
        return '📷 Imagem';
    if (!message && type === 'audio')
        return '🎤 Áudio';
    if (!message && type === 'video')
        return '🎬 Vídeo';
    if (!message && type === 'document')
        return '📄 Documento';
    if (!message)
        return 'Sem mensagens';
    const maxLength = 40;
    return message.length > maxLength ? message.substring(0, maxLength) + '...' : message;
};
export function ConversationList({ conversations = [], selectedId, onSelect, tags = [], team = [], loading, onRefresh, filters, onFiltersChange, isAdmin = false, connections, onNewConversation, onAcceptConversation, onReleaseConversation, onArchiveConversation, onFinishConversation, onReopenConversation, attendanceCounts, onGlobalSearchSelect, onPinConversation, onFavoriteConversation, onMuteConversation, onLoadMore, hasMore = false, loadingMore = false, }) {
    const isMobile = useIsMobile();
    const [localSearch, setLocalSearch] = useState(filters.search);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [conversationToDelete, setConversationToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [keepContact, setKeepContact] = useState(true);
    const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
    const [profilePictures, setProfilePictures] = useState({});
    const [myDepartments, setMyDepartments] = useState([]);
    const [allDepartments, setAllDepartments] = useState([]);
    const { toast } = useToast();
    const { isConversationMuted, isGroupMuted, settings: notifSettings, toggleGroupAllowed } = useNotificationSound();
    // Load departments
    useEffect(() => {
        const loadDepartments = async () => {
            try {
                // Load all departments for display/filter
                const all = await api('/api/departments');
                setAllDepartments(all);
                // Load user's departments for "my departments" filter
                const my = await api('/api/departments/user/my-departments');
                setMyDepartments(my);
            }
            catch (error) {
                console.debug('Failed to load departments:', error);
            }
        };
        loadDepartments();
    }, []);
    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localSearch !== filters.search) {
                onFiltersChange({ ...filters, search: localSearch });
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [localSearch, filters, onFiltersChange]);
    // Fetch profile pictures for visible conversations
    useEffect(() => {
        const fetchProfilePictures = async () => {
            // Only fetch for individual chats (not groups) that don't have photos yet
            const toFetch = conversations.filter(conv => !conv.is_group && conv.contact_phone && !profilePictures[conv.id]).slice(0, 15); // Limit to 15 at a time
            if (toFetch.length === 0)
                return;
            try {
                const result = await api('/api/wapi/profile-pictures', {
                    method: 'POST',
                    body: {
                        conversations: toFetch.map(c => ({
                            id: c.id,
                            connection_id: c.connection_id,
                            contact_phone: c.contact_phone,
                            is_group: c.is_group,
                        })),
                    },
                });
                if (result.pictures && Object.keys(result.pictures).length > 0) {
                    setProfilePictures(prev => ({ ...prev, ...result.pictures }));
                }
            }
            catch (error) {
                // Silently fail - profile pictures are optional
                console.debug('Profile pictures fetch failed:', error);
            }
        };
        // Delay to avoid too many requests
        const timer = setTimeout(fetchProfilePictures, 1000);
        return () => clearTimeout(timer);
    }, [conversations]);
    // Auto-sync group names for groups without proper names
    const [groupsSynced, setGroupsSynced] = useState(false);
    const [groupSyncRetries, setGroupSyncRetries] = useState(0);
    useEffect(() => {
        if (groupsSynced)
            return;
        const groupsWithoutNames = conversations.filter(c => c.is_group && (!c.group_name || c.group_name === 'Grupo' || c.group_name === 'Grupo sem nome'));
        if (groupsWithoutNames.length === 0) {
            setGroupsSynced(true);
            return;
        }
        const syncGroupNames = async () => {
            try {
                const result = await api('/api/chat/sync-group-names', { method: 'POST' });
                if (result.updated > 0) {
                    console.log(`[Chat] Synced ${result.updated} group names`);
                    onRefresh();
                    setGroupsSynced(true);
                }
                else if (groupSyncRetries < 2) {
                    // Retry up to 2 more times with increasing delay
                    setGroupSyncRetries(prev => prev + 1);
                }
                else {
                    setGroupsSynced(true);
                }
            }
            catch (e) {
                console.debug('Group name sync failed:', e);
                if (groupSyncRetries < 2) {
                    setGroupSyncRetries(prev => prev + 1);
                }
                else {
                    setGroupsSynced(true);
                }
            }
        };
        const delay = 2000 + groupSyncRetries * 5000;
        const timer = setTimeout(syncGroupNames, delay);
        return () => clearTimeout(timer);
    }, [conversations, groupsSynced, groupSyncRetries]);
    const handleDeleteConversation = async () => {
        if (!conversationToDelete)
            return;
        setDeleting(true);
        try {
            await api(`/api/chat/conversations/${conversationToDelete.id}?keep_contact=${keepContact}`, { method: 'DELETE' });
            toast({
                title: "Conversa excluída com sucesso",
                description: keepContact ? "Contato mantido para futuras conversas" : undefined
            });
            setDeleteDialogOpen(false);
            setConversationToDelete(null);
            setKeepContact(true);
            onRefresh();
        }
        catch (error) {
            toast({
                title: "Erro ao excluir",
                description: error.message || "Não foi possível excluir a conversa",
                variant: "destructive"
            });
        }
        finally {
            setDeleting(false);
        }
    };
    const handleCleanupDuplicates = async () => {
        setDeleting(true);
        try {
            const result = await api('/api/chat/conversations/cleanup-duplicates', { method: 'POST' });
            toast({
                title: "Limpeza concluída",
                description: result.message
            });
            onRefresh();
        }
        catch (error) {
            toast({
                title: "Erro na limpeza",
                description: error.message || "Não foi possível limpar duplicatas",
                variant: "destructive"
            });
        }
        finally {
            setDeleting(false);
        }
    };
    const handleCleanupEmpty = async () => {
        setDeleting(true);
        try {
            const result = await api('/api/chat/conversations/cleanup-empty', { method: 'POST' });
            toast({
                title: "Limpeza concluída",
                description: result.message
            });
            onRefresh();
        }
        catch (error) {
            toast({
                title: "Erro na limpeza",
                description: error.message || "Não foi possível limpar conversas vazias",
                variant: "destructive"
            });
        }
        finally {
            setDeleting(false);
        }
    };
    const getInitials = (name) => {
        if (!name)
            return '?';
        return name
            .split(' ')
            .slice(0, 2)
            .map(n => n[0])
            .join('')
            .toUpperCase();
    };
    const handleQuickDate = (type) => {
        let start;
        let end;
        switch (type) {
            case 'today':
                start = startOfDay(new Date());
                end = endOfDay(new Date());
                break;
            case 'yesterday':
                start = startOfDay(subDays(new Date(), 1));
                end = endOfDay(subDays(new Date(), 1));
                break;
            case 'week':
                start = startOfDay(subDays(new Date(), 7));
                end = endOfDay(new Date());
                break;
            case 'month':
                start = startOfDay(subDays(new Date(), 30));
                end = endOfDay(new Date());
                break;
            case 'clear':
                onFiltersChange({ ...filters, startDate: undefined, endDate: undefined });
                return;
        }
        if (start && end) {
            onFiltersChange({
                ...filters,
                startDate: start.toISOString(),
                endDate: end.toISOString()
            });
        }
    };
    return (<div className="flex flex-col h-full border-r bg-card overflow-hidden max-w-full">
      {/* Header */}
      <div className={cn("p-4 border-b space-y-3 flex-shrink-0", isMobile && "pl-16")}>
        <div className="flex items-center justify-between min-w-0">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary"/>
            Conversas
          </h2>
          <div className="flex items-center gap-1">
            {/* New Conversation Button */}
            {onNewConversation && (<Button variant="ghost" size="icon" onClick={onNewConversation} title="Nova conversa" className="text-primary hover:text-primary">
                <Plus className="h-4 w-4"/>
              </Button>)}
            
            {isAdmin && (<DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={deleting} title="Ferramentas de limpeza">
                    <Sparkles className="h-4 w-4 text-amber-500"/>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleCleanupEmpty} disabled={deleting}>
                    <Trash2 className="h-4 w-4 mr-2"/>
                    Limpar conversas vazias
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCleanupDuplicates} disabled={deleting}>
                    <Sparkles className="h-4 w-4 mr-2"/>
                    Limpar duplicadas (@lid)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>)}
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
            <Input placeholder="Buscar conversas..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} className="pl-9"/>
          </div>
          {onGlobalSearchSelect && (<Button variant="outline" size="icon" onClick={() => setGlobalSearchOpen(true)} title="Buscar em todas as mensagens" className="flex-shrink-0">
              <SearchCode className="h-4 w-4"/>
            </Button>)}
        </div>

        {/* Attendance Status Tabs - Icons with labels below */}
        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
          <button onClick={() => onFiltersChange({ ...filters, attendance_status: 'attending' })} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-md text-xs font-medium transition-colors", filters.attendance_status === 'attending'
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground")}>
            <div className="relative">
              <CheckCircle className="h-4 w-4"/>
              {attendanceCounts && attendanceCounts.attending > 0 && (<Badge variant="secondary" className="absolute -top-2 -right-3 h-4 min-w-4 px-1 text-[9px] font-bold">
                  {attendanceCounts.attending}
                </Badge>)}
            </div>
            <span className="text-[10px] mt-1">Atendendo</span>
          </button>
          <button onClick={() => onFiltersChange({ ...filters, attendance_status: 'waiting' })} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-md text-xs font-medium transition-colors", filters.attendance_status === 'waiting'
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground")}>
            <div className="relative">
              <Clock className="h-4 w-4"/>
              {attendanceCounts && attendanceCounts.waiting > 0 && (<Badge variant="destructive" className="absolute -top-2 -right-3 h-4 min-w-4 px-1 text-[9px] font-bold animate-pulse">
                  {attendanceCounts.waiting}
                </Badge>)}
            </div>
            <span className="text-[10px] mt-1">Aguardando</span>
          </button>
          <button onClick={() => onFiltersChange({ ...filters, attendance_status: 'finished' })} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-md text-xs font-medium transition-colors", filters.attendance_status === 'finished'
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground")}>
            <div className="relative">
              <CheckCheck className="h-4 w-4"/>
              {attendanceCounts && attendanceCounts.finished > 0 && (<Badge variant="outline" className="absolute -top-2 -right-3 h-4 min-w-4 px-1 text-[9px] font-bold border-green-500 text-green-600">
                  {attendanceCounts.finished}
                </Badge>)}
            </div>
            <span className="text-[10px] mt-1">Finalizados</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 overflow-x-auto min-w-0 scrollbar-none">
          {/* Status filter */}
          <Select value={filters.assigned} onValueChange={(v) => onFiltersChange({ ...filters, assigned: v })}>
            <SelectTrigger className="flex-1 h-8 text-xs min-w-[80px] max-w-[100px]">
              <UserCheck className="h-3 w-3 mr-1"/>
              <SelectValue placeholder="Atendente"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="me">Minhas</SelectItem>
              <SelectItem value="unassigned">Sem atendente</SelectItem>
              {team.map(member => (<SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>))}
            </SelectContent>
          </Select>

          {/* Date Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-8 text-xs px-2 gap-1 min-w-[32px] max-w-[120px]", (filters.startDate || filters.endDate) && "border-primary text-primary")}>
                <CalendarDays className="h-3.5 w-3.5"/>
                <span className="hidden sm:inline">
                  {filters.startDate ? format(new Date(filters.startDate), 'dd/MM') : 'Data'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex flex-col border-b p-2 gap-1 bg-muted/50">
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handleQuickDate('today')}>Hoje</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handleQuickDate('yesterday')}>Ontem</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handleQuickDate('week')}>7 dias</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => handleQuickDate('month')}>30 dias</Button>
                  {(filters.startDate || filters.endDate) && (<Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive" onClick={() => handleQuickDate('clear')}>Limpar</Button>)}
                </div>
              </div>
              <Calendar initialFocus mode="range" selected={{
            from: filters.startDate ? new Date(filters.startDate) : undefined,
            to: filters.endDate ? new Date(filters.endDate) : undefined,
        }} onSelect={(range) => {
            onFiltersChange({
                ...filters,
                startDate: range?.from?.toISOString(),
                endDate: range?.to?.toISOString(),
            });
        }} numberOfMonths={1} locale={ptBR}/>
            </PopoverContent>
          </Popover>

          {/* Tag filter */}
          <Select value={filters.tag} onValueChange={(v) => onFiltersChange({ ...filters, tag: v })}>
            <SelectTrigger className="flex-1 h-8 text-xs min-w-[100px] max-w-[130px]">
              <Tag className="h-3 w-3 mr-1"/>
              <SelectValue placeholder="Tag"/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Tags</SelectItem>
              {Array.isArray(tags) && tags.map(tag => (<SelectItem key={tag.id} value={tag.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}/>
                    <span className="truncate max-w-[80px]">{tag.name}</span>
                  </div>
                </SelectItem>))}
            </SelectContent>
          </Select>

          {/* Connection filter */}
          <div className="flex-shrink-0">
            <Select value={filters.selectedConnections && filters.selectedConnections.length > 0
            ? (filters.selectedConnections.length === (connections?.length || 0) ? "all" : "multiple")
            : filters.connection} onValueChange={(v) => {
            if (v === 'all') {
                onFiltersChange({ ...filters, connection: 'all', selectedConnections: [] });
            }
            else if (v !== 'multiple') {
                onFiltersChange({ ...filters, connection: v, selectedConnections: [v] });
            }
        }}>
              <SelectTrigger className="flex-1 h-8 text-xs min-w-[100px] max-w-[140px]">
                <Smartphone className="h-3 w-3 mr-1"/>
                <SelectValue>
                  {filters.selectedConnections && filters.selectedConnections.length > 1
            ? `${filters.selectedConnections.length} Conexões`
            : (filters.connection === 'all' ? "Todas conexões" : "Conexão")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <div className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", (filters.connection === 'all' || (filters.selectedConnections?.length === connections?.length && connections?.length > 0)) && "bg-accent")} onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFiltersChange({ ...filters, connection: 'all', selectedConnections: [] });
        }}>
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {(filters.connection === 'all' || (filters.selectedConnections?.length === connections?.length && connections?.length > 0)) && (<CheckCircle className="h-4 w-4"/>)}
                  </span>
                  Todas conexões
                </div>
                
                <div className="max-h-[300px] overflow-y-auto border-t mt-1 pt-1">
                  {connections && connections.map(conn => {
            const isSelected = filters.selectedConnections?.includes(conn.id) || filters.connection === conn.id;
            return (<div key={conn.id} className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", isSelected && "bg-accent")} onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let newSelected = [...(filters.selectedConnections || [])];
                    if (filters.connection !== 'all' && filters.connection !== 'multiple' && !newSelected.includes(filters.connection)) {
                        newSelected.push(filters.connection);
                    }
                    if (newSelected.includes(conn.id)) {
                        newSelected = newSelected.filter(id => id !== conn.id);
                    }
                    else {
                        newSelected.push(conn.id);
                    }
                    const allSelected = newSelected.length === connections.length;
                    onFiltersChange({
                        ...filters,
                        connection: allSelected ? 'all' : (newSelected.length === 0 ? 'all' : 'multiple'),
                        selectedConnections: allSelected ? [] : newSelected
                    });
                }}>
                        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                          {isSelected && <CheckCircle className="h-4 w-4"/>}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", String(conn.status || '').toLowerCase() === 'connected' ? "bg-green-500" : "bg-red-400")}/>
                          {conn.name}
                        </div>
                      </div>);
        })}
                </div>
              </SelectContent>
            </Select>
          </div>


          {/* Department filter - show if there are any departments */}
          {Array.isArray(allDepartments) && allDepartments.length > 0 && (<Select value={filters.department} onValueChange={(v) => onFiltersChange({ ...filters, department: v })}>
              <SelectTrigger className="flex-1 h-8 text-xs min-w-[70px] max-w-[90px]">
                <Building2 className="h-3 w-3 mr-1"/>
                <SelectValue placeholder="Depto"/>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Array.isArray(myDepartments) && myDepartments.length > 0 && (<SelectItem value="my">Meus deptos</SelectItem>)}
                {Array.isArray(allDepartments) && allDepartments.map(dept => (<SelectItem key={dept.id} value={dept.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color || '#6b7280' }}/>
                      {dept.name}
                    </div>
                  </SelectItem>))}
              </SelectContent>
            </Select>)}

          {/* Favorite filter toggle */}
          <Button variant={filters.favorite ? "default" : "ghost"} size="icon" className={cn("h-8 w-8 flex-shrink-0 transition-colors", filters.favorite && "bg-yellow-500 hover:bg-yellow-600 text-white")} onClick={() => onFiltersChange({ ...filters, favorite: !filters.favorite })} title={filters.favorite ? "Ver todas" : "Ver favoritas"}>
            <Star className={cn("h-3 w-3", filters.favorite && "fill-current")}/>
          </Button>

          {/* Archive toggle */}
          <Button variant={filters.archived ? "default" : "ghost"} size="icon" className={cn("h-8 w-8 flex-shrink-0 transition-colors", filters.archived && "bg-amber-500 hover:bg-amber-600 text-white")} onClick={() => onFiltersChange({ ...filters, archived: !filters.archived })} title={filters.archived ? "Ver ativas" : "Ver arquivadas"}>
            <Archive className="h-3 w-3"/>
          </Button>
        </div>

        {/* Archived mode banner */}
        {filters.archived && (<div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 dark:text-amber-400">
            <Archive className="h-4 w-4 flex-shrink-0"/>
            <span className="text-xs font-medium">Exibindo conversas arquivadas</span>
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/20" onClick={() => onFiltersChange({ ...filters, archived: false })}>
              Voltar às ativas
            </Button>
          </div>)}
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        {loading && conversations.length === 0 ? (<div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
          </div>) : conversations.length === 0 ? (<div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
            <MessageSquare className="h-12 w-12 mb-2 opacity-50"/>
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>) : (<div className="divide-y">
            {Array.isArray(conversations) && conversations.map((conv) => {
                // Use the actual conversation status, not the filter
                const isWaiting = conv.attendance_status === 'waiting';
                const isAttending = conv.attendance_status === 'attending';
                const isFinished = conv.attendance_status === 'finished';
                const connColor = getConnectionColor(conv.connection_id, connections);
                const conversationContent = (<div className={cn("flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-accent/50 group relative", selectedId === conv.id && "bg-accent")} style={connColor ? { borderLeft: `3px solid ${connColor}` } : undefined} onClick={() => onSelect(conv)}>
                  {/* Avatar with profile picture */}
                  <Avatar className="h-12 w-12 flex-shrink-0" onClick={() => onSelect(conv)}>
                    {profilePictures[conv.id] && (<AvatarImage src={profilePictures[conv.id]} alt={conv.contact_name || 'Avatar'} className="object-cover"/>)}
                    <AvatarFallback className={cn("text-primary", conv.is_group ? "bg-blue-100 dark:bg-blue-900/30" : "bg-primary/10")}>
                      {conv.is_group ? (<Users className="h-5 w-5"/>) : (getInitials(conv.contact_name))}
                    </AvatarFallback>
                  </Avatar>

                   {/* Content - improved z-index and click area */}
                   <div className="flex-1 min-w-0 relative" onClick={() => onSelect(conv)}>
                     <div className="absolute -inset-y-4 -inset-x-4 cursor-pointer z-0" onClick={() => onSelect(conv)}/>
                    <div className="relative z-10 flex flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium truncate flex-1 min-w-0 flex items-center gap-1">
                        {conv.is_pinned && <Pin className="h-3 w-3 text-primary flex-shrink-0"/>}
                        {conv.is_favorite && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0"/>}
                        {conv.is_muted && <BellOff className="h-3 w-3 text-muted-foreground flex-shrink-0"/>}
                         {(conv.automation_active || conv.active_flow) && (<Tooltip>
                             <TooltipTrigger asChild>
                               <Zap className={cn("h-3 w-3 flex-shrink-0 fill-current", conv.active_flow ? "text-blue-500" : "text-purple-500 animate-pulse")}/>
                             </TooltipTrigger>
                             <TooltipContent side="right" className="max-w-[250px]">
                               {conv.active_flow ? (<div className="space-y-1">
                                   <p className="font-semibold text-xs flex items-center gap-1">
                                     <Zap className="h-3 w-3"/> Fluxo: {conv.active_flow.flow_name}
                                   </p>
                                   <p className="text-[10px] opacity-90">Etapa: {conv.active_flow.node_name || 'Início'}</p>
                                   {conv.active_flow.wait_reply_expires_at && (<p className="text-[10px] text-blue-400 font-medium">Aguardando resposta do contato</p>)}
                                 </div>) : (<p>Automação ativa aguardando resposta</p>)}
                             </TooltipContent>
                           </Tooltip>)}
                        {conv.is_group
                        ? (conv.group_name || 'Grupo sem nome')
                        : (conv.contact_name || conv.contact_phone || 'Desconhecido')}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-1">
                        {conv.last_message_at
                        ? formatDistanceToNow(new Date(conv.last_message_at), {
                            addSuffix: false,
                            locale: ptBR,
                        })
                        : ''}
                      </span>
                    </div>

                    {/* Last message preview */}
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                      {getMessageTypeIcon(conv.last_message_type)}
                      <span className="truncate">
                        {getMessagePreview(conv.last_message, conv.last_message_type)}
                      </span>
                    </div>

                    {/* Tags and Department row */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {/* Department badge */}
                      {conv.department_name && (() => {
                        const deptColor = allDepartments.find(d => d.id === conv.department_id)?.color || '#6b7280';
                        return (<Badge variant="outline" className="text-[10px] px-1.5 py-0" style={{
                                borderColor: deptColor,
                                color: deptColor,
                                backgroundColor: `${deptColor}15`
                            }}>
                            <Building2 className="h-2.5 w-2.5 mr-0.5"/>
                            {conv.department_name}
                          </Badge>);
                    })()}
                      
                      {/* Tags */}
                      {(Array.isArray(conv.tags) ? conv.tags : []).slice(0, 2).map(tag => (<Badge key={tag.id} variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: tag.color, color: tag.color }}>
                          {tag.name}
                        </Badge>))}
                      {(Array.isArray(conv.tags) ? conv.tags : []).length > 2 && (<span className="text-[10px] text-muted-foreground">
                          +{conv.tags.length - 2}
                        </span>)}
                    </div>

                    {/* Connection name, Assigned user, and Unread count */}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {/* Connection name - prominent when multiple connections */}
                      {conv.connection_name && connections && connections.length > 1 && (<Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5" style={connColor ? {
                            borderColor: connColor,
                            color: connColor,
                            backgroundColor: `${connColor}15`
                        } : undefined}>
                          <Smartphone className="h-2.5 w-2.5"/>
                          {conv.connection_name}
                        </Badge>)}
                      {conv.connection_name && (!connections || connections.length <= 1) && (<span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[70px]">
                          {conv.connection_name}
                        </span>)}
                      
                      {/* Assigned user */}
                      {conv.assigned_name && (<Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {conv.assigned_name.split(' ')[0]}
                        </Badge>)}

                      {/* Muted indicator */}
                      {(isConversationMuted(conv.id) || isGroupMuted(conv.is_group, conv.id)) && (<BellOff className="h-3 w-3 text-muted-foreground"/>)}

                      {/* Unread count */}
                      {conv.unread_count > 0 && (<Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 min-w-[20px] justify-center">
                          {conv.unread_count}
                        </Badge>)}
                    </div>
                    </div>
                  </div>

                  {/* Accept button - visible for waiting conversations */}
                  {isWaiting && onAcceptConversation && (<Button variant="default" size="sm" className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white flex-shrink-0 gap-1" onClick={(e) => {
                            e.stopPropagation();
                            onAcceptConversation(conv.id);
                        }}>
                      <CheckCircle className="h-3.5 w-3.5"/>
                      Aceitar
                    </Button>)}

                  {/* Finish button - visible for attending conversations */}
                  {isAttending && onFinishConversation && (<Button variant="outline" size="sm" className="h-7 px-2 text-xs flex-shrink-0 gap-1 text-muted-foreground hover:bg-green-50 hover:text-green-600 hover:border-green-200" onClick={(e) => {
                            e.stopPropagation();
                            console.log('Clicking Finish button for:', conv.id);
                            onFinishConversation(conv.id);
                        }}>
                      <CheckCheck className="h-3.5 w-3.5"/>
                      Finalizar
                    </Button>)}

                  {/* Actions dropdown - desktop only */}
                  {!isMobile && (<DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 opacity-60 hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4"/>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isWaiting && onAcceptConversation && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onAcceptConversation(conv.id);
                            }}>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-500"/>
                            Aceitar conversa
                          </DropdownMenuItem>)}
                        {isFinished && onReopenConversation && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onReopenConversation(conv.id);
                            }}>
                            <RotateCcw className="h-4 w-4 mr-2 text-blue-500"/>
                            Reabrir conversa
                          </DropdownMenuItem>)}
                        {onPinConversation && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onPinConversation(conv.id, !conv.is_pinned);
                            }}>
                            <Pin className={cn("h-4 w-4 mr-2", conv.is_pinned && "text-primary")}/>
                            {conv.is_pinned ? 'Desafixar' : 'Fixar no topo'}
                          </DropdownMenuItem>)}
                        {onFavoriteConversation && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onFavoriteConversation(conv.id, !conv.is_favorite);
                            }}>
                            <Star className={cn("h-4 w-4 mr-2", conv.is_favorite && "text-yellow-500 fill-yellow-500")}/>
                            {conv.is_favorite ? 'Remover favorito' : 'Favoritar'}
                          </DropdownMenuItem>)}
                        {onMuteConversation && !(conv.is_group && notifSettings.muteGroups) && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                onMuteConversation(conv.id, !conv.is_muted);
                            }}>
                            <BellOff className={cn("h-4 w-4 mr-2", conv.is_muted && "text-muted-foreground")}/>
                            {conv.is_muted ? 'Reativar notificações' : 'Silenciar notificações'}
                          </DropdownMenuItem>)}
                        {conv.is_group && notifSettings.muteGroups && (<DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                toggleGroupAllowed(conv.id);
                            }}>
                            {(notifSettings.allowedGroups || []).includes(conv.id) ? (<><BellOff className="h-4 w-4 mr-2 text-muted-foreground"/>Silenciar este grupo</>) : (<><Bell className="h-4 w-4 mr-2"/>Reativar notificações</>)}
                          </DropdownMenuItem>)}
                        {isAdmin && (<DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => {
                                e.stopPropagation();
                                setConversationToDelete(conv);
                                setDeleteDialogOpen(true);
                            }}>
                            <Trash2 className="h-4 w-4 mr-2"/>
                            Excluir conversa
                          </DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>)}
                </div>);
                // Wrap with swipeable on mobile
                if (isMobile) {
                    return (<SwipeableConversationItem key={conv.id} isWaiting={isWaiting} isAttending={isAttending} isAdmin={isAdmin} onAccept={onAcceptConversation ? () => onAcceptConversation(conv.id) : undefined} onRelease={onReleaseConversation ? () => onReleaseConversation(conv.id) : undefined} onArchive={onArchiveConversation ? () => onArchiveConversation(conv.id) : undefined} onDelete={isAdmin ? () => {
                            setConversationToDelete(conv);
                            setDeleteDialogOpen(true);
                        } : undefined}>
                    {conversationContent}
                  </SwipeableConversationItem>);
                }
                return <div key={conv.id}>{conversationContent}</div>;
            })}
            
            {/* Load More Button */}
            {hasMore && (<div className="p-4 flex justify-center">
                <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore} className="text-primary hover:text-primary hover:bg-primary/10">
                  {loadingMore ? (<>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                      Carregando mais...
                    </>) : ("Carregar mais conversas")}
                </Button>
              </div>)}
          </div>)}
      </ScrollArea>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open)
                setKeepContact(true);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  Tem certeza que deseja excluir a conversa com{" "}
                  <strong>{conversationToDelete?.contact_name || conversationToDelete?.contact_phone || "este contato"}</strong>?
                </p>
                <p className="text-sm">
                  Esta ação irá remover permanentemente todas as mensagens, notas e tags associadas.
                </p>
                
                {/* Keep contact option */}
                {conversationToDelete?.contact_phone && (<div className="flex items-center gap-3 p-3 rounded-lg bg-accent/50 border">
                    <input type="checkbox" id="keepContact" checked={keepContact} onChange={(e) => setKeepContact(e.target.checked)} className="h-4 w-4 rounded border-gray-300"/>
                    <label htmlFor="keepContact" className="text-sm cursor-pointer">
                      <span className="font-medium">Manter contato para futuras conversas</span>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        O contato será salvo e a conversa poderá ser reiniciada depois
                      </span>
                    </label>
                  </div>)}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConversation} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? (<>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                  Excluindo...
                </>) : ("Excluir conversa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Global Search Dialog */}
      {onGlobalSearchSelect && (<GlobalSearchDialog open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} onSelectResult={onGlobalSearchSelect}/>)}
    </div>);
}
