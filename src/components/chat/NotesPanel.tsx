import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  StickyNote,
  Plus,
  Edit,
  Trash2,
  X,
  Loader2,
  Check,
  Save,
} from "lucide-react";
import { useChat, ConversationNote } from "@/hooks/use-chat";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface NotesPanelProps {
  conversationId: string;
  onClose: () => void;
}

export function NotesPanel({ conversationId, onClose }: NotesPanelProps) {
  const isMobile = useIsMobile();
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { getNotes, createNote, updateNote, deleteNote } = useChat();
  const { user } = useAuth();

  useEffect(() => {
    loadNotes();
  }, [conversationId]);

  const loadNotes = async () => {
    setLoading(true);
    const data = await getNotes(conversationId);
    setNotes(data);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newNote.trim()) return;

    setSaving(true);
    const note = await createNote(conversationId, `💭 Anotação do Chat: ${newNote.trim()}`);
    setSaving(false);

    if (note) {
      setNotes([note, ...notes]);
      setNewNote("");
      toast.success("Anotação criada!");
    } else {
      toast.error("Erro ao criar anotação");
    }
  };

  const handleEdit = (note: ConversationNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;

    setSaving(true);
    const updated = await updateNote(conversationId, editingId, editContent.trim());
    setSaving(false);

    if (updated) {
      setNotes(notes.map(n => n.id === editingId ? { ...n, content: editContent.trim() } : n));
      setEditingId(null);
      setEditContent("");
      toast.success("Anotação atualizada!");
    } else {
      toast.error("Erro ao atualizar anotação");
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta anotação?")) return;

    const success = await deleteNote(conversationId, noteId);
    if (success) {
      setNotes(notes.filter(n => n.id !== noteId));
      toast.success("Anotação excluída!");
    } else {
      toast.error("Erro ao excluir anotação");
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className={cn(
      "flex flex-col bg-card overflow-x-hidden",
      isMobile 
        ? "fixed inset-0 z-50 h-full w-full" 
        : "h-full border-l w-80 shrink-0 min-w-[20rem]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold">Anotações Internas</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* New Note */}
      <div className="p-3 border-b">
        <Textarea
          placeholder="Adicionar nova anotação..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          rows={3}
          className="resize-none text-sm"
        />
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={handleCreate}
          disabled={!newNote.trim() || saving}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Adicionar Anotação
        </Button>
      </div>

      {/* Notes List */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <StickyNote className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">Nenhuma anotação</p>
            <p className="text-xs mt-1">
              Adicione notas internas sobre este contato
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className={cn(
                  "p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30",
                  editingId === note.id && "ring-2 ring-primary"
                )}
              >
                {editingId === note.id ? (
                  <div>
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="resize-none text-sm mb-2"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={!editContent.trim() || saving}
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3 mr-1" />
                        )}
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 mb-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px] bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                          {getInitials(note.user_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium truncate">
                            {note.user_name || 'Usuário'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(note.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-sm whitespace-pre-wrap break-words">
                      {note.content}
                    </p>

                    {note.user_id === user?.id && (
                      <div className="flex justify-end gap-1 mt-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleEdit(note)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(note.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
