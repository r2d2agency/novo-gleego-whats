import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Edit2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TagWithCount {
  id: string;
  name: string;
  color: string;
  conversation_count: number;
  created_at: string;
}

interface TagContact {
  conversation_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  is_group: boolean;
  group_name: string | null;
  attendance_status: string | null;
  is_archived: boolean;
  connection_name: string | null;
  assigned_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_customer_message: string | null;
  last_customer_message_at: string | null;
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#64748b", // slate
];

const Tags = () => {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<TagWithCount | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);

  const [contactsDialogOpen, setContactsDialogOpen] = useState(false);
  const [contactsTag, setContactsTag] = useState<TagWithCount | null>(null);
  const [contacts, setContacts] = useState<TagContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  useEffect(() => {
    loadTags();
  }, []);

  const loadTags = async () => {
    setLoading(true);
    try {
      const data = await api<TagWithCount[]>("/api/chat/tags/with-count");
      setTags(data);
    } catch (error) {
      console.error("Error loading tags:", error);
      toast.error("Erro ao carregar tags");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setSelectedTag(null);
    setTagName("");
    setTagColor("#6366f1");
    setDialogOpen(true);
  };

  const handleOpenEdit = (tag: TagWithCount) => {
    setSelectedTag(tag);
    setTagName(tag.name);
    setTagColor(tag.color);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!tagName.trim()) {
      toast.error("Nome da tag é obrigatório");
      return;
    }

    setSaving(true);
    try {
      if (selectedTag) {
        await api(`/api/chat/tags/${selectedTag.id}`, {
          method: "PATCH",
          body: { name: tagName, color: tagColor },
        });
        toast.success("Tag atualizada");
      } else {
        await api("/api/chat/tags", {
          method: "POST",
          body: { name: tagName, color: tagColor },
        });
        toast.success("Tag criada");
      }
      setDialogOpen(false);
      loadTags();
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar tag");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTag) return;

    setSaving(true);
    try {
      await api(`/api/chat/tags/${selectedTag.id}`, { method: "DELETE" });
      toast.success("Tag excluída");
      setDeleteDialogOpen(false);
      loadTags();
    } catch (error: any) {
      toast.error(error.message || "Erro ao excluir tag");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenContacts = async (tag: TagWithCount) => {
    setContactsTag(tag);
    setContactsDialogOpen(true);
    setContactsLoading(true);
    try {
      const data = await api<TagContact[]>(`/api/chat/tags/${tag.id}/contacts`);
      setContacts(data);
    } catch (error) {
      console.error("Error loading tag contacts:", error);
      toast.error("Erro ao carregar contatos da tag");
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  };

  const totalConversations = tags.reduce((acc, tag) => acc + tag.conversation_count, 0);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Tag className="h-6 w-6 text-primary" />
              Tags
            </h1>
            <p className="text-muted-foreground">
              Gerencie as tags de conversas
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={loadTags} disabled={loading} variant="outline">
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Atualizar
            </Button>
            <Button onClick={handleOpenCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Tag
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total de Tags</p>
                  <p className="text-2xl font-bold">{tags.length}</p>
                </div>
                <Tag className="h-8 w-8 text-primary/30" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Conversas Tagueadas</p>
                  <p className="text-2xl font-bold">{totalConversations}</p>
                </div>
                <MessageSquare className="h-8 w-8 text-primary/30" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tags List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Todas as Tags</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Tag className="h-12 w-12 mb-2 opacity-50" />
                <p>Nenhuma tag criada</p>
                <Button variant="link" onClick={handleOpenCreate} className="mt-2">
                  Criar primeira tag
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenContacts(tag)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") handleOpenContacts(tag);
                      }}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/30 transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-4 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <div>
                          <p className="font-medium">{tag.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {tag.conversation_count} {tag.conversation_count === 1 ? "conversa" : "conversas"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(tag);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTag(tag);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedTag ? "Editar Tag" : "Nova Tag"}</DialogTitle>
            <DialogDescription>
              {selectedTag ? "Altere o nome ou cor da tag" : "Crie uma nova tag para organizar conversas"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Nome</label>
              <Input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="Ex: Suporte, Vendas, Urgente..."
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Cor</label>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all",
                      tagColor === color && "ring-2 ring-offset-2 ring-primary"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setTagColor(color)}
                  />
                ))}
                <Input
                  type="color"
                  value={tagColor}
                  onChange={(e) => setTagColor(e.target.value)}
                  className="w-10 h-8 p-0 border-0 cursor-pointer"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Badge
                variant="outline"
                style={{ borderColor: tagColor, color: tagColor }}
              >
                {tagName || "Preview"}
              </Badge>
              <span className="text-sm text-muted-foreground">Preview da tag</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {selectedTag ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a tag "{selectedTag?.name}"?
              Ela será removida de todas as {selectedTag?.conversation_count} conversas associadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Contacts by Tag Dialog */}
      <Dialog open={contactsDialogOpen} onOpenChange={setContactsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {contactsTag && (
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: contactsTag.color }}
                />
              )}
              Contatos com a tag "{contactsTag?.name}"
            </DialogTitle>
            <DialogDescription>
              Última conversa ativa = último momento em que o cliente respondeu
            </DialogDescription>
          </DialogHeader>

          {contactsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mb-2 opacity-50" />
              <p>Nenhum contato com esta tag</p>
            </div>
          ) : (
            <ScrollArea className="h-[420px]">
              <div className="space-y-2 pr-3">
                {contacts.map((contact) => (
                  <div
                    key={contact.conversation_id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {contact.is_group
                          ? contact.group_name || "Grupo sem nome"
                          : contact.contact_name || contact.contact_phone || "Desconhecido"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {contact.contact_phone}
                        {contact.assigned_name ? ` · Atendido por ${contact.assigned_name}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      {contact.last_customer_message_at ? (
                        <>
                          <p className="text-xs text-muted-foreground">Última resposta do cliente</p>
                          <p className="text-sm font-medium">
                            {formatDistanceToNow(new Date(contact.last_customer_message_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </p>
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Cliente nunca respondeu
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Tags;
