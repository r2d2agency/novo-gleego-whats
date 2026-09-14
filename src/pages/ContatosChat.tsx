import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  Edit2,
  FileSpreadsheet,
  FolderPlus,
  Link2,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ExcelImportDialog } from "@/components/contatos/ExcelImportDialog";

interface ChatContact {
  id: string;
  name: string | null;
  phone: string | null;
  jid: string | null;
  connection_id: string;
  connection_name: string | null;
  has_conversation: boolean;
  created_at: string | null;
}

interface Connection {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
  provider?: string;
  instance_id?: string;
}

interface ContactList {
  id: string;
  name: string;
  connection_id: string | null;
  connection_name: string | null;
  contact_count: number;
  created_at: string;
}

interface Contact {
  id: string;
  list_id: string;
  name: string;
  phone: string;
  is_whatsapp?: boolean | null;
  created_at: string;
}

const ContatosChat = () => {
  const navigate = useNavigate();
  const NONE_CONNECTION_VALUE = "__none__";
  const [activeTab, setActiveTab] = useState("chat");
  
  // Chat contacts state
  const [chatContacts, setChatContacts] = useState<ChatContact[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("all");
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ChatContact | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  // Contact lists state
  const [lists, setLists] = useState<ContactList[]>([]);
  const [selectedList, setSelectedList] = useState<ContactList | null>(null);
  const [listContacts, setListContacts] = useState<Contact[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  
  // New list dialog
  const [showNewListDialog, setShowNewListDialog] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListConnectionId, setNewListConnectionId] = useState("");
  
  // Add contact dialog
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  
  // Add chat contact dialog (for agenda tab)
  const [showAddChatContactDialog, setShowAddChatContactDialog] = useState(false);
  const [newChatContactName, setNewChatContactName] = useState("");
  const [newChatContactPhone, setNewChatContactPhone] = useState("");
  const [newChatContactConnectionId, setNewChatContactConnectionId] = useState("");
  const [addingChatContact, setAddingChatContact] = useState(false);
  
  // Import dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState("");
  const [validateWhatsApp, setValidateWhatsApp] = useState(true);
  
  // Excel import for chat contacts
  const [showChatImportDialog, setShowChatImportDialog] = useState(false);
  const [showExcelDialog, setShowExcelDialog] = useState(false);
  const [selectedConnectionForImport, setSelectedConnectionForImport] = useState("");
  
  // Multi-select for bulk delete
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<ChatContact | null>(null);
  const [deletingContact, setDeletingContact] = useState(false);
  
  // Pagination for chat contacts
  const [visibleCount, setVisibleCount] = useState(100);

  // Find W-API connection for bulk validation
  const wapiConnection = connections.find(c => (c as any).provider === 'wapi' || (c as any).instance_id);

  const validateWhatsAppBulkFn = async (phones: string[]): Promise<{ phone: string; exists: boolean }[]> => {
    const connId = wapiConnection?.id || selectedConnectionForImport;
    if (!connId) throw new Error("Nenhuma conexão disponível");
    const result = await api<{ success: boolean; results: { phone: string; exists: boolean }[] }>(
      `/api/wapi/${connId}/validate-numbers`,
      { method: 'POST', body: { phones } }
    );
    return result.results;
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === "lists") {
      loadLists();
    }
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [contactsData, connectionsData] = await Promise.all([
        api<ChatContact[]>("/api/chat/contacts"),
        // Agora respeita os grupos de acesso ao não usar scope=organization
        api<Connection[]>("/api/connections"),
      ]);
      setChatContacts(contactsData);
      setConnections(connectionsData);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Erro ao carregar contatos");
    } finally {
      setLoading(false);
    }
  };

  const loadLists = async () => {
    setLoadingLists(true);
    try {
      const data = await api<ContactList[]>('/api/contacts/lists');
      setLists(data);
    } catch (err) {
      toast.error("Erro ao carregar listas");
    } finally {
      setLoadingLists(false);
    }
  };

  const loadListContacts = async (listId: string) => {
    setLoadingLists(true);
    try {
      const data = await api<Contact[]>(`/api/contacts/lists/${listId}/contacts`);
      setListContacts(data);
    } catch (err) {
      toast.error("Erro ao carregar contatos");
    } finally {
      setLoadingLists(false);
    }
  };

  const handleSelectList = (list: ContactList) => {
    setSelectedList(list);
    loadListContacts(list.id);
  };

  // Chat contact handlers
  const handleEdit = (contact: ChatContact) => {
    setSelectedContact(contact);
    setEditName(contact.name || "");
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedContact) return;

    setSaving(true);
    try {
      // Update contact in agenda
      await api(`/api/chat/contacts/${selectedContact.id}`, {
        method: "PATCH",
        body: { name: editName.trim() || selectedContact.phone },
      });
      toast.success("Contato atualizado");
      setEditDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar contato");
    } finally {
      setSaving(false);
    }
  };

  // List handlers
  const handleCreateList = async () => {
    if (!newListName.trim()) {
      toast.error("Digite um nome para a lista");
      return;
    }

    setLoadingLists(true);
    try {
      await api('/api/contacts/lists', {
        method: 'POST',
        body: {
          name: newListName.trim(),
          connection_id: newListConnectionId || undefined,
        },
      });
      toast.success("Lista criada com sucesso!");
      setNewListName("");
      setNewListConnectionId("");
      setShowNewListDialog(false);
      loadLists();
    } catch (err) {
      toast.error("Erro ao criar lista");
    } finally {
      setLoadingLists(false);
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta lista e todos os contatos?")) return;

    setLoadingLists(true);
    try {
      await api(`/api/contacts/lists/${listId}`, { method: 'DELETE' });
      toast.success("Lista excluída!");
      if (selectedList?.id === listId) {
        setSelectedList(null);
        setListContacts([]);
      }
      loadLists();
    } catch (err) {
      toast.error("Erro ao excluir lista");
    } finally {
      setLoadingLists(false);
    }
  };

  const handleAddContact = async () => {
    if (!selectedList) return;
    if (!newContactName.trim() || !newContactPhone.trim()) {
      toast.error("Preencha nome e telefone");
      return;
    }

    const cleanPhone = newContactPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      toast.error("Número de telefone inválido");
      return;
    }

    setLoadingLists(true);
    try {
      await api(`/api/contacts/lists/${selectedList.id}/contacts`, {
        method: 'POST',
        body: {
          name: newContactName.trim(),
          phone: cleanPhone,
        },
      });
      toast.success("Contato adicionado!");
      setNewContactName("");
      setNewContactPhone("");
      setShowAddContactDialog(false);
      loadListContacts(selectedList.id);
      loadLists();
    } catch (err) {
      toast.error("Erro ao adicionar contato");
    } finally {
      setLoadingLists(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!selectedList) return;

    setLoadingLists(true);
    try {
      await api(`/api/contacts/${contactId}`, { method: 'DELETE' });
      toast.success("Contato excluído!");
      loadListContacts(selectedList.id);
      loadLists();
    } catch (err) {
      toast.error("Erro ao excluir contato");
    } finally {
      setLoadingLists(false);
    }
  };

  const handleImportContacts = async () => {
    if (!selectedList || !importData.trim()) {
      toast.error("Cole os contatos no formato: nome,telefone (um por linha)");
      return;
    }

    const lines = importData.trim().split('\n');
    const parsedContacts: { name: string; phone: string }[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      let parts = trimmedLine.split(',');
      if (parts.length < 2) parts = trimmedLine.split(';');
      if (parts.length < 2) parts = trimmedLine.split('\t');

      if (parts.length >= 2) {
        const name = parts[0].trim();
        const phone = parts[1].trim().replace(/\D/g, '');
        
        if (name && phone.length >= 10) {
          parsedContacts.push({ name, phone });
        }
      }
    }

    if (parsedContacts.length === 0) {
      toast.error("Nenhum contato válido encontrado. Use o formato: nome,telefone");
      return;
    }

    setLoadingLists(true);
    try {
      const result = await api<{ imported: number; duplicates: number; invalid_whatsapp?: number }>(
        `/api/contacts/lists/${selectedList.id}/import`,
        {
          method: 'POST',
          body: { 
            contacts: parsedContacts,
            validate_whatsapp: validateWhatsApp && !!selectedList.connection_id
          },
        }
      );
      
      let description = `${result.imported} contatos importados`;
      if (result.duplicates) description += `, ${result.duplicates} duplicados`;
      if (result.invalid_whatsapp) description += `, ${result.invalid_whatsapp} números inválidos`;
      
      toast.success("Importação concluída!", { description });
      setImportData("");
      setShowImportDialog(false);
      loadListContacts(selectedList.id);
      loadLists();
    } catch (err) {
      toast.error("Erro ao importar contatos");
    } finally {
      setLoadingLists(false);
    }
  };

  // Import chat contacts from Excel (to agenda, not conversations)
  const handleImportChatContacts = async (contacts: { name: string; phone: string }[]) => {
    if (!selectedConnectionForImport) {
      toast.error("Selecione uma conexão para importar");
      return;
    }

    try {
      const result = await api<{ imported: number; duplicates: number }>(
        "/api/chat/contacts/import",
        {
          method: "POST",
          body: {
            connection_id: selectedConnectionForImport,
            contacts: contacts.map(c => ({
              name: c.name,
              phone: c.phone,
            })),
          },
        }
      );

      let description = `${result.imported} contatos importados para a agenda`;
      if (result.duplicates) description += `, ${result.duplicates} já existiam`;

      toast.success("Importação concluída!", { description });
      setShowChatImportDialog(false);
      setSelectedConnectionForImport("");
      loadData();
    } catch (err) {
      toast.error("Erro ao importar contatos");
      throw err;
    }
  };

  // Start conversation with a contact from agenda
  const handleStartConversation = async (contact: ChatContact) => {
    if (!contact.phone) {
      toast.error("Contato sem telefone");
      return;
    }

    try {
      const result = await api<{ id: string; existed: boolean }>(
        "/api/chat/conversations",
        {
          method: "POST",
          body: {
            connection_id: contact.connection_id,
            contact_phone: contact.phone,
            contact_name: contact.name || undefined,
          },
        }
      );

      navigate(`/chat?conversation=${result.id}`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao iniciar conversa");
    }
  };

  // Add chat contact manually
  const handleAddChatContact = async () => {
    if (!newChatContactName.trim() || !newChatContactPhone.trim() || !newChatContactConnectionId) {
      toast.error("Preencha todos os campos");
      return;
    }

    let phone = newChatContactPhone.replace(/\D/g, '');
    if (phone.length <= 11) phone = '55' + phone;

    setAddingChatContact(true);
    try {
      await api('/api/chat/contacts/by-phone', {
        method: 'POST',
        body: {
          phone,
          connection_id: newChatContactConnectionId,
          name: newChatContactName.trim(),
        },
      });
      toast.success("Contato adicionado à agenda!");
      setNewChatContactName("");
      setNewChatContactPhone("");
      setNewChatContactConnectionId("");
      setShowAddChatContactDialog(false);
      loadData();
    } catch (err) {
      toast.error("Erro ao adicionar contato");
    } finally {
      setAddingChatContact(false);
    }
  };

  // Delete contact from agenda (opens confirmation dialog)
  const handleDeleteChatContact = (contact: ChatContact) => {
    setContactToDelete(contact);
  };

  // Confirm deletion of the contact (and its conversation, if any)
  const confirmDeleteChatContact = async () => {
    if (!contactToDelete) return;

    setDeletingContact(true);
    try {
      await api(`/api/chat/contacts/${contactToDelete.id}`, { method: "DELETE" });
      toast.success(
        contactToDelete.has_conversation
          ? "Contato e conversa excluídos com sucesso"
          : "Contato excluído da agenda"
      );
      setContactToDelete(null);
      loadData();
    } catch (err) {
      toast.error("Erro ao excluir contato");
    } finally {
      setDeletingContact(false);
    }
  };

  // Toggle single contact selection
  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedContactIds.size === filteredChatContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(filteredChatContacts.map(c => c.id)));
    }
  };

  // Bulk delete contacts
  const handleBulkDelete = async () => {
    if (selectedContactIds.size === 0) return;

    setDeletingBulk(true);
    try {
      const result = await api<{ success: boolean; deleted: number; conversations_deleted?: number }>("/api/chat/contacts/bulk-delete", {
        method: "POST",
        body: { contact_ids: Array.from(selectedContactIds) },
      });

      if ((result.deleted || 0) === 0) {
        toast.error("Nenhum contato foi excluído", {
          description: "Esses itens não estavam na agenda ou você não tem permissão.",
        });
      } else if (result.conversations_deleted) {
        toast.success(
          `${result.deleted} contato(s) e ${result.conversations_deleted} conversa(s) excluído(s)`
        );
      } else {
        toast.success(`${result.deleted} contato(s) excluído(s) da agenda`);
      }

      setSelectedContactIds(new Set());
      setShowBulkDeleteDialog(false);
      loadData();
    } catch (err) {
      toast.error("Erro ao excluir contatos");
    } finally {
      setDeletingBulk(false);
    }
  };

  const getInitials = (name: string | null | undefined, phone: string | null | undefined): string => {
    if (name && typeof name === 'string' && name.trim()) {
      const parts = name.trim().split(" ").filter(p => p.length > 0);
      if (parts.length > 0) {
        return parts.slice(0, 2).map(n => n[0] || '').join("").toUpperCase() || "??";
      }
    }
    if (phone && typeof phone === 'string' && phone.length >= 2) {
      return phone.slice(-2);
    }
    return "??";
  };

  const filteredChatContacts = chatContacts.filter(contact => {
    const q = search.toLowerCase();
    const name = (contact.name || "").toLowerCase();
    const phone = contact.phone || "";

    const matchesSearch = !search || name.includes(q) || phone.includes(search);
    const matchesConnection = connectionFilter === "all" || contact.connection_id === connectionFilter;
    return matchesSearch && matchesConnection;
  });

  const paginatedContacts = filteredChatContacts.slice(0, visibleCount);
  const hasMore = filteredChatContacts.length > visibleCount;


  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Contatos
            </h1>
            <p className="text-muted-foreground">
              Gerencie contatos do chat e listas para campanhas
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Contatos do Chat
            </TabsTrigger>
            <TabsTrigger value="lists" className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4" />
              Listas de Contatos
            </TabsTrigger>
          </TabsList>

          {/* Chat Contacts Tab */}
          <TabsContent value="chat" className="space-y-4 mt-6">
            {/* Stats and Actions */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total de Contatos</p>
                    <p className="text-2xl font-bold">{chatContacts.length}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="default" size="sm" onClick={() => setShowAddChatContactDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Adicionar Contato
                    </Button>
                    <Dialog open={showChatImportDialog} onOpenChange={(open) => {
                      setShowChatImportDialog(open);
                      if (!open) setSelectedConnectionForImport("");
                    }}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Importar Excel
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Importar Contatos do Excel</DialogTitle>
                          <DialogDescription>
                            Selecione a conexão e importe os contatos da planilha
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Conexão *</Label>
                            <Select 
                              value={selectedConnectionForImport} 
                              onValueChange={setSelectedConnectionForImport}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a conexão" />
                              </SelectTrigger>
                              <SelectContent>
                                {connections.filter(c => c.status === "connected").map(conn => (
                                  <SelectItem key={conn.id} value={conn.id}>
                                    {conn.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Os contatos serão salvos na agenda. Para iniciar uma conversa, clique no contato.
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="gradient"
                            disabled={!selectedConnectionForImport}
                            onClick={() => {
                              setShowChatImportDialog(false);
                              setShowExcelDialog(true);
                            }}
                          >
                            Continuar
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button onClick={loadData} disabled={loading} variant="outline" size="sm">
                      <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                      Atualizar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nome ou telefone..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Conexão" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas conexões</SelectItem>
                      {connections.map(conn => (
                        <SelectItem key={conn.id} value={conn.id}>
                          {conn.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Contacts List */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Contatos ({filteredChatContacts.length})
                  </CardTitle>
                  {selectedContactIds.size > 0 && (
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => setShowBulkDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir {selectedContactIds.size} selecionado(s)
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredChatContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mb-2 opacity-50" />
                    <p>Nenhum contato encontrado</p>
                  </div>
                ) : (
                  <>
                    {/* Select All */}
                    <div className="flex items-center gap-3 mb-4 p-3 bg-muted/50 rounded-lg">
                      <Checkbox
                        id="select-all"
                        checked={selectedContactIds.size === filteredChatContacts.length && filteredChatContacts.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                      <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                        Selecionar todos ({filteredChatContacts.length})
                      </label>
                    </div>
                    
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {paginatedContacts.map((contact) => (
                          <div
                            key={contact.id}
                            className={cn(
                              "flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors group",
                              selectedContactIds.has(contact.id) && "bg-primary/5 border-primary/30"
                            )}
                          >
                            <Checkbox
                              checked={selectedContactIds.has(contact.id)}
                              onCheckedChange={() => toggleContactSelection(contact.id)}
                            />
                            
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {getInitials(contact.name, contact.phone)}
                              </AvatarFallback>
                            </Avatar>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">
                                {contact.name || "Sem nome"}
                              </p>
                              {contact.has_conversation && (
                                <Badge variant="outline" className="text-xs">
                                  Conversa ativa
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <span>{contact.phone || "Sem telefone"}</span>
                            </div>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                              {contact.connection_name || "Sem conexão"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(contact)}
                              title="Editar nome"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleStartConversation(contact)}
                              title="Iniciar conversa"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteChatContact(contact)}
                              title="Excluir da agenda"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        ))}
                        {hasMore && (
                          <div className="flex justify-center pt-4">
                            <Button
                              variant="outline"
                              onClick={() => setVisibleCount(prev => prev + 100)}
                            >
                              Carregar mais ({filteredChatContacts.length - visibleCount} restantes)
                            </Button>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Add Chat Contact Dialog */}
            <Dialog open={showAddChatContactDialog} onOpenChange={setShowAddChatContactDialog}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Adicionar Contato à Agenda</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Conexão *</Label>
                    <Select value={newChatContactConnectionId} onValueChange={setNewChatContactConnectionId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a conexão" />
                      </SelectTrigger>
                      <SelectContent>
                        {connections.filter(c => c.status === "connected").map(conn => (
                          <SelectItem key={conn.id} value={conn.id}>
                            {conn.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Nome *</Label>
                    <Input
                      value={newChatContactName}
                      onChange={(e) => setNewChatContactName(e.target.value)}
                      placeholder="Nome do contato"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefone *</Label>
                    <Input
                      value={newChatContactPhone}
                      onChange={(e) => setNewChatContactPhone(e.target.value)}
                      placeholder="5511999999999"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddChatContactDialog(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleAddChatContact}
                    disabled={addingChatContact || !newChatContactName.trim() || !newChatContactPhone.trim() || !newChatContactConnectionId}
                  >
                    {addingChatContact ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Adicionar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Single Delete Confirmation Dialog */}
            <AlertDialog open={!!contactToDelete} onOpenChange={(open) => { if (!open) setContactToDelete(null); }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir contato</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>
                        Tem certeza que deseja excluir{" "}
                        <strong>{contactToDelete?.name || contactToDelete?.phone || "este contato"}</strong> da agenda?
                      </p>
                      {contactToDelete?.has_conversation && (
                        <p className="text-destructive font-medium">
                          Este contato possui uma conversa ativa. A conversa e todo o histórico de mensagens também serão excluídos permanentemente.
                        </p>
                      )}
                      <p>Esta ação não pode ser desfeita.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletingContact}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmDeleteChatContact}
                    disabled={deletingContact}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deletingContact ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Excluindo...
                      </>
                    ) : (
                      "Excluir"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Delete Confirmation Dialog */}
            <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirmar exclusão</DialogTitle>
                  <DialogDescription asChild>
                    <div className="space-y-2">
                      <p>
                        Tem certeza que deseja excluir {selectedContactIds.size} contato(s) da agenda?
                      </p>
                      {Array.from(selectedContactIds).some(
                        id => chatContacts.find(c => c.id === id)?.has_conversation
                      ) && (
                        <p className="text-destructive font-medium">
                          Alguns contatos selecionados possuem conversa ativa. As conversas e o histórico de mensagens também serão excluídos permanentemente.
                        </p>
                      )}
                      <p>Esta ação não pode ser desfeita.</p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowBulkDeleteDialog(false)}
                    disabled={deletingBulk}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={handleBulkDelete}
                    disabled={deletingBulk}
                  >
                    {deletingBulk ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Excluindo...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir {selectedContactIds.size} contato(s)
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Contact Lists Tab */}
          <TabsContent value="lists" className="mt-6">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Lists Panel */}
              <Card className="lg:col-span-1">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FolderPlus className="h-4 w-4 text-primary" />
                        Listas de Contatos
                      </CardTitle>
                      <CardDescription>
                        {lists.length} lista{lists.length !== 1 ? 's' : ''} criada{lists.length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                    
                    <Dialog open={showNewListDialog} onOpenChange={setShowNewListDialog}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Nova Lista de Contatos</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Nome da Lista</Label>
                            <Input
                              value={newListName}
                              onChange={(e) => setNewListName(e.target.value)}
                              placeholder="Ex: Clientes VIP"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Conexão (opcional)</Label>
                              <Select
                                value={newListConnectionId || NONE_CONNECTION_VALUE}
                                onValueChange={(v) =>
                                  setNewListConnectionId(v === NONE_CONNECTION_VALUE ? "" : v)
                                }
                              >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione uma conexão" />
                              </SelectTrigger>
                              <SelectContent>
                                  <SelectItem value={NONE_CONNECTION_VALUE}>Nenhuma conexão</SelectItem>
                                  {connections
                                    .filter((conn) => conn.id && conn.id.trim() !== "")
                                    .map((conn) => (
                                  <SelectItem key={conn.id} value={conn.id}>
                                    {conn.name} {conn.phone_number ? `(${conn.phone_number})` : ''}
                                  </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Vincular a uma conexão permite validar números e usar para campanhas
                            </p>
                          </div>
                          <Button onClick={handleCreateList} className="w-full" disabled={loadingLists}>
                            {loadingLists ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Criar Lista
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    {loadingLists && lists.length === 0 ? (
                      <div className="flex items-center justify-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : lists.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FolderPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Nenhuma lista criada</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {lists.map((list) => (
                          <div
                            key={list.id}
                            className={`p-3 rounded-lg border cursor-pointer transition-all ${
                              selectedList?.id === list.id
                                ? 'bg-primary/10 border-primary'
                                : 'hover:bg-accent'
                            }`}
                            onClick={() => handleSelectList(list)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{list.name}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="secondary" className="text-xs">
                                    <Users className="h-3 w-3 mr-1" />
                                    {list.contact_count}
                                  </Badge>
                                  {list.connection_name && (
                                    <Badge variant="outline" className="text-xs">
                                      <Link2 className="h-3 w-3 mr-1" />
                                      {list.connection_name}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteList(list.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Contacts Panel */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Phone className="h-4 w-4 text-primary" />
                        {selectedList ? selectedList.name : 'Selecione uma lista'}
                      </CardTitle>
                      <CardDescription>
                        {selectedList ? `${listContacts.length} contato${listContacts.length !== 1 ? 's' : ''}` : 'Clique em uma lista para ver os contatos'}
                      </CardDescription>
                    </div>
                    
                    {selectedList && (
                      <div className="flex gap-2">
                        {/* Add Contact Dialog */}
                        <Dialog open={showAddContactDialog} onOpenChange={setShowAddContactDialog}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              <Plus className="h-4 w-4 mr-1" />
                              Adicionar
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Adicionar Contato</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>Nome</Label>
                                <Input
                                  value={newContactName}
                                  onChange={(e) => setNewContactName(e.target.value)}
                                  placeholder="Nome do contato"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Telefone</Label>
                                <Input
                                  value={newContactPhone}
                                  onChange={(e) => setNewContactPhone(e.target.value)}
                                  placeholder="Ex: 11999999999"
                                />
                              </div>
                              <Button onClick={handleAddContact} className="w-full" disabled={loadingLists}>
                                {loadingLists ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Adicionar Contato
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>

                        {/* Import Dialog */}
                        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              <Upload className="h-4 w-4 mr-1" />
                              Importar
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <FileSpreadsheet className="h-5 w-5" />
                                Importar Contatos
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>Cole os contatos (um por linha)</Label>
                                <Textarea
                                  value={importData}
                                  onChange={(e) => setImportData(e.target.value)}
                                  placeholder="João Silva,11999999999&#10;Maria Santos,11888888888&#10;Pedro Costa,11777777777"
                                  className="min-h-[200px] font-mono text-sm"
                                />
                              </div>
                              
                              {/* WhatsApp validation option */}
                              {selectedList?.connection_id && (
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/50 border">
                                  <Checkbox
                                    id="validateWhatsApp"
                                    checked={validateWhatsApp}
                                    onCheckedChange={(checked) => setValidateWhatsApp(checked === true)}
                                  />
                                  <label htmlFor="validateWhatsApp" className="text-sm cursor-pointer flex-1">
                                    <span className="font-medium flex items-center gap-1">
                                      <CheckCircle className="h-4 w-4 text-green-500" />
                                      Validar números no WhatsApp
                                    </span>
                                    <br />
                                    <span className="text-xs text-muted-foreground">
                                      Importa apenas números que existem no WhatsApp (mais lento)
                                    </span>
                                  </label>
                                </div>
                              )}

                              <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">
                                <p className="font-medium mb-1">Formato aceito:</p>
                                <p>nome,telefone (separado por vírgula, ponto-e-vírgula ou tab)</p>
                                <p className="mt-1">Telefone deve ter pelo menos 10 dígitos (DDD + número)</p>
                              </div>
                              <Button onClick={handleImportContacts} className="w-full" disabled={loadingLists}>
                                {loadingLists ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {validateWhatsApp && selectedList?.connection_id ? 'Validando...' : 'Importando...'}
                                  </>
                                ) : (
                                  <>
                                    <Upload className="h-4 w-4" />
                                    Importar Contatos
                                  </>
                                )}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!selectedList ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <FolderPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Selecione uma lista para gerenciar os contatos</p>
                    </div>
                  ) : loadingLists && listContacts.length === 0 ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : listContacts.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhum contato nesta lista</p>
                      <p className="text-sm mt-1">Adicione contatos manualmente ou importe em massa</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Telefone</TableHead>
                            <TableHead className="w-20">WhatsApp</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {listContacts.map((contact) => (
                            <TableRow key={contact.id}>
                              <TableCell className="font-medium">{contact.name}</TableCell>
                              <TableCell className="text-muted-foreground">{contact.phone}</TableCell>
                              <TableCell>
                                {contact.is_whatsapp === true && (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                )}
                                {contact.is_whatsapp === false && (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                )}
                                {contact.is_whatsapp === null && (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleDeleteContact(contact.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Chat Contact Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
            <DialogDescription>
              Altere o nome do contato. O número de telefone não pode ser alterado.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Telefone</label>
              <p className="text-sm mt-1">{selectedContact?.phone}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Nome</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Digite o nome do contato"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excel Import Dialog for Chat Contacts */}
      <ExcelImportDialog
        open={showExcelDialog}
        onOpenChange={(open) => {
          setShowExcelDialog(open);
          if (!open) setSelectedConnectionForImport("");
        }}
        onImport={handleImportChatContacts}
        validateWhatsAppBulk={wapiConnection ? validateWhatsAppBulkFn : undefined}
      />
    </MainLayout>
  );
};

export default ContatosChat;
