import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send,
  Image,
  Mic,
  FileText,
  Video,
  MoreVertical,
  Tag,
  UserPlus,
  Archive,
  Phone,
  Loader2,
  Check,
  X,
  MessageSquare,
  Upload,
  ArrowLeftRight,
  ArrowLeft,
  Plus,
  RefreshCw,
  PenLine,
  Zap as ZapIcon,
  StickyNote,
  Reply,
  Search,
   ChevronUp,
   ChevronDown,
   ChevronRight,
   ChevronLeft,
  Trash2,
  Square,
   CalendarClock,
   Clock,
  Users,
  Undo2,
  RotateCcw,
  Bot,
  Building2,
  Briefcase,
  Sparkles,
  BellOff,
  Bell,
  Pin,
  Contact as ContactIcon,
  X as XIcon,
  LayoutList,
  FileSignature,
} from "lucide-react";
import { SendInteractiveMenuDialog } from "./SendInteractiveMenuDialog";
import { cn } from "@/lib/utils";
import { ChatMessage, Conversation, ConversationTag, TeamMember, Connection } from "@/hooks/use-chat";
import { useChat } from "@/hooks/use-chat";
import { useDepartments, Department } from "@/hooks/use-departments";
import { useUpload } from "@/hooks/use-upload";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { QuickRepliesPanel } from "./QuickRepliesPanel";
import { useQuickReplies, QuickReply } from "@/hooks/use-quick-replies";
import { ConversationSummaryPanel, SummaryBadge } from "./ConversationSummaryPanel";
import { SentimentIndicator } from "./SentimentIndicator";
import { ActionSuggestions } from "./ActionSuggestions";
import { useFinishWithSummary, useGenerateSummary } from "@/hooks/use-conversation-summary";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { NotesPanel } from "./NotesPanel";
import { AudioWaveform } from "./AudioWaveform";
import { TypingIndicator } from "./TypingIndicator";
import { EmojiPicker } from "./EmojiPicker";
import { MentionSuggestions, useMentions } from "./MentionSuggestions";
import { ScheduleMessageDialog } from "./ScheduleMessageDialog";
import { ScheduledMessage } from "@/hooks/use-chat";
import { StartFlowDialog } from "./StartFlowDialog";
import { DealLinkDialog } from "./DealLinkDialog";
import { CallLogDialog } from "./CallLogDialog";
import { useCRMDealsByPhone, CRMDeal } from "@/hooks/use-crm";
import { DealDetailDialog } from "@/components/crm/DealDetailDialog";
import { AIAgentBanner } from "./AIAgentBanner";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ForwardMessageDialog } from "./ForwardMessageDialog";
import { RequestSignatureDialog } from "./RequestSignatureDialog";
import { SendTemplateDialog } from "./SendTemplateDialog";
import { SendContactDialog } from "./SendContactDialog";
import {
  TransferDialog,
  DepartmentDialog,
  DeleteConversationDialog,
  SyncDialog,
  CreateTagDialog,
  EditContactDialog,
} from "./ChatDialogs";
 import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
 import { format, isSameDay, parseISO } from "date-fns";
 import { ptBR } from "date-fns/locale";
import { exportConversationAsTxt, exportConversationAsPdf } from "@/lib/chat-export";
import { Download } from "lucide-react";

interface ChatAreaProps {
  conversation: Conversation | null;
  messages: ChatMessage[];
  conversations?: Conversation[];
  loading: boolean;
  sending: boolean;
  syncingHistory?: boolean;
  tags: ConversationTag[];
  team: TeamMember[];
  connections?: Connection[];
  isAdmin?: boolean;
  userRole?: string;
  onSyncHistory?: (days: number) => Promise<void>;
  onSendMessage: (content: string, type?: string, mediaUrl?: string, quotedMessageId?: string, mediaMimetype?: string, duration?: number) => Promise<void>;
  onForwardMessage?: (targetConversationId: string, message: ChatMessage) => Promise<void>;
  onLoadMore: () => void;
  hasMore: boolean;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onAssign: (userId: string | null) => void;
  onArchive: () => void;
  onTransfer: (userId: string | null, note?: string) => void;
  onCreateTag: (name: string, color: string) => void;
  onDeleteConversation?: () => Promise<void>;
  onReleaseConversation?: () => Promise<void>;
  onFinishConversation?: () => Promise<void>;
  onReopenConversation?: () => Promise<void>;
  onDepartmentChange?: (departmentId: string | null) => void;
  isMobile?: boolean;
  onMobileBack?: () => void;
  onOpenCRM?: () => void;
}

export function ChatArea({
  conversation,
  messages,
  conversations = [],
  loading,
  sending,
  syncingHistory,
  tags = [],
  team = [],
  connections = [],
  isAdmin = false,
  userRole,
  onSyncHistory,
  onSendMessage,
  onForwardMessage,
  onLoadMore,
  hasMore,
  onAddTag,
  onRemoveTag,
  onAssign,
  onArchive,
  onTransfer,
  onCreateTag,
  onDeleteConversation,
  onReleaseConversation,
  onFinishConversation,
  onReopenConversation,
  onDepartmentChange,
  isMobile = false,
  onMobileBack,
  onOpenCRM,
}: ChatAreaProps) {
  const isViewOnly = userRole === 'manager';
  
  // Departments
  const { getDepartments, transferToDepartment } = useDepartments();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false);
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [signMessages, setSignMessages] = useState(() => {
    const saved = localStorage.getItem('chat-sign-messages');
    return saved === 'true';
  });
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashReplies, setSlashReplies] = useState<QuickReply[]>([]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const { getQuickReplies: fetchQuickRepliesForSlash } = useQuickReplies();
  const [showNotes, setShowNotes] = useState(false);
  const [notesCount, setNotesCount] = useState(0);
  const [showExtras, setShowExtras] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [isContactTyping, setIsContactTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [schedulingMessage, setSchedulingMessage] = useState(false);
  const [showEditContactDialog, setShowEditContactDialog] = useState(false);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [showStartFlowDialog, setShowStartFlowDialog] = useState(false);
  const [showSendContactDialog, setShowSendContactDialog] = useState(false);
  const [showDealDialog, setShowDealDialog] = useState(false);
  const [showDealDetailDialog, setShowDealDetailDialog] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<CRMDeal | null>(null);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [showCallDialog, setShowCallDialog] = useState(false);
  const [savingCall, setSavingCall] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showInteractiveMenuDialog, setShowInteractiveMenuDialog] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [aiAgentActive, setAiAgentActive] = useState(false);
  const [showHeaderInfo, setShowHeaderInfo] = useState(() => {
    const saved = localStorage.getItem('chat-show-header-info');
    return saved === null ? true : saved === 'true';
  });
   const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
   const [historyDays, setHistoryDays] = useState(() => {
     const saved = localStorage.getItem('chat-history-days');
     return saved ? parseInt(saved) : 30;
   });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { uploadFile, isUploading, progress: uploadProgress, resetProgress } = useUpload();
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; preview?: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ active: boolean; current: number; total: number; fileName: string } | null>(null);
  const dragCounterRef = useRef(0);
  const { user, modulesEnabled } = useAuth();
   const { getNotes, getTypingStatus, getScheduledMessages, scheduleMessage, cancelScheduledMessage, logCall, editMessage, deleteMessage: deleteMessageFn, pinMessage, cancelActiveFlow, retryMediaDownload } = useChat();
  const [pinnedMessage, setPinnedMessage] = useState<ChatMessage | null>(null);
  
  const finishWithSummary = useFinishWithSummary();
  const generateSummary = useGenerateSummary();
  const { isConversationMuted, toggleConversationMute, settings: notifSettings, updateSettings: updateNotifSettings } = useNotificationSound();
  
  const { data: contactDeals, isLoading: loadingDeals } = useCRMDealsByPhone(
    conversation?.contact_phone && !conversation.is_group ? conversation.contact_phone : null
  );
  const openDeals = (contactDeals || []).filter(
    (d) => (d as any)?.status && String((d as any).status).toLowerCase() === 'open'
  );

  // Detect current connection provider
  const isMetaConnection = connections.some(
    (c) => c.id === conversation?.connection_id && c.provider === 'meta'
  );

  const isUazapiConnection = connections.some(
    (c) => c.id === conversation?.connection_id && (c.provider === 'uazapi' || (c as any).uazapi_url)
  );

  const {
    isRecording, duration, audioBlob, audioLevels,
    startRecording, stopRecording, cancelRecording, clearAudio, formatDuration,
  } = useAudioRecorder();

  const {
    isListening, fullTranscript, isSupported: isSpeechSupported,
    error: speechError, startListening, stopListening, cancelListening, clearError: clearSpeechError,
  } = useSpeechRecognition();

  useEffect(() => {
    if (speechError) { toast.error(speechError); clearSpeechError(); }
  }, [speechError, clearSpeechError]);

  const {
    showSuggestions: showMentionSuggestions, mentionQuery, suggestionPosition,
    handleSelectMember, closeSuggestions,
  } = useMentions({ text: messageText, setText: setMessageText, team, textareaRef });

  // Load pinned message
  useEffect(() => {
    if (conversation?.pinned_message_id && messages.length > 0) {
      const pinned = messages.find(m => m.id === conversation.pinned_message_id);
      setPinnedMessage(pinned || null);
    } else {
      setPinnedMessage(null);
    }
  }, [conversation?.pinned_message_id, messages]);

  // Load notes count
  useEffect(() => {
    if (conversation?.id) {
      getNotes(conversation.id).then(notes => setNotesCount(notes.length));
    } else { setNotesCount(0); }
  }, [conversation?.id, showNotes]);

  // Load departments when dialog opens
  useEffect(() => {
    if (showDepartmentDialog) {
      getDepartments().then(setDepartments);
    }
  }, [showDepartmentDialog, getDepartments]);

  // Fetch profile picture
  useEffect(() => {
    setProfilePictureUrl(null);
    if (!conversation?.id || conversation.is_group || !conversation.contact_phone) return;
    const fetchProfilePicture = async () => {
      try {
        const result = await api<{ pictures: Record<string, string> }>('/api/wapi/profile-pictures', {
          method: 'POST',
          body: { conversations: [{ id: conversation.id, connection_id: conversation.connection_id, contact_phone: conversation.contact_phone, is_group: false }] },
        });
        if (result.pictures?.[conversation.id]) setProfilePictureUrl(result.pictures[conversation.id]);
      } catch { console.debug('Profile picture fetch failed'); }
    };
    fetchProfilePicture();
  }, [conversation?.id, conversation?.contact_phone, conversation?.is_group]);

  // Load scheduled messages
  useEffect(() => {
    if (showScheduleDialog && conversation?.id) {
      getScheduledMessages(conversation.id).then(setScheduledMessages);
    }
  }, [showScheduleDialog, conversation?.id, getScheduledMessages]);

  // Poll typing status
  useEffect(() => {
    if (!conversation?.id) { setIsContactTyping(false); return; }
    const checkTyping = async () => { const isTyping = await getTypingStatus(conversation.id); setIsContactTyping(isTyping); };
    checkTyping();
    const interval = setInterval(checkTyping, 2000);
    return () => clearInterval(interval);
  }, [conversation?.id, getTypingStatus]);

  useEffect(() => { localStorage.setItem('chat-sign-messages', signMessages.toString()); }, [signMessages]);

   useEffect(() => {
     localStorage.setItem('chat-show-header-info', showHeaderInfo.toString());
   }, [showHeaderInfo]);
 
   useEffect(() => {
     localStorage.setItem('chat-history-days', historyDays.toString());
   }, [historyDays]);

  // Reset initial load
  useEffect(() => {
    isInitialLoadRef.current = true;
    isUserScrollingRef.current = false;
    setShowScrollButton(false);
  }, [conversation?.id]);

  // Scroll to bottom - only on initial load or new incoming/sent messages
  const prevMessageCountRef = useRef(0);
  
  useEffect(() => {
    if (!messages.length) { prevMessageCountRef.current = 0; return; }
    
    if (isInitialLoadRef.current) {
      const attempts = [50, 150, 300];
      attempts.forEach((delay) => {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          if (delay === attempts[attempts.length - 1]) isInitialLoadRef.current = false;
        }, delay);
      });
      prevMessageCountRef.current = messages.length;
      return;
    }
    
    if (showSearch) { prevMessageCountRef.current = messages.length; return; }
    
    // Only auto-scroll when new messages arrive (count increased)
    const hasNewMessages = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    
    if (!hasNewMessages) return;
    
    const lastMsg = messages[messages.length - 1];
    const isOwnMessage = lastMsg?.from_me;
    
    // Always scroll for own messages; for received messages, only if user is NOT scrolled up
    if (isOwnMessage) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        isUserScrollingRef.current = false;
      }, 30);
    } else if (!isUserScrollingRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 30);
    }
  }, [messages, showSearch]);

  // Track scroll
   // Track scroll position and handle infinite scroll
   const lastScrollHeightRef = useRef(0);
   const isAdjustmentNeededRef = useRef(false);
 
   useEffect(() => {
     const container = scrollContainerRef.current;
     if (!container) return;
     let scrollTimeout: NodeJS.Timeout;
     
     const handleScroll = () => {
       const { scrollTop, scrollHeight, clientHeight } = container;
       const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
       
       setShowScrollButton(distanceFromBottom > 300);
       
       if (scrollTop < lastScrollTopRef.current && distanceFromBottom > 150) {
         isUserScrollingRef.current = true;
       }
       
       if (distanceFromBottom < 50) {
         isUserScrollingRef.current = false;
       }
 
       // Infinite scroll: trigger onLoadMore when reaching the top
       if (scrollTop < 50 && hasMore && !loading && !isInitialLoadRef.current) {
         lastScrollHeightRef.current = scrollHeight;
         isAdjustmentNeededRef.current = true;
         onLoadMore();
       }
 
       lastScrollTopRef.current = scrollTop;
       
       clearTimeout(scrollTimeout);
       scrollTimeout = setTimeout(() => { 
         if (distanceFromBottom < 50) isUserScrollingRef.current = false; 
       }, 150);
     };
 
     container.addEventListener('scroll', handleScroll, { passive: true });
     return () => { 
       container.removeEventListener('scroll', handleScroll); 
       clearTimeout(scrollTimeout); 
     };
   }, [conversation?.id, hasMore, loading, onLoadMore]);
 
   // Adjust scroll position after loading more messages to prevent jumping to the bottom
   useEffect(() => {
     if (isAdjustmentNeededRef.current && !loading && scrollContainerRef.current) {
       const container = scrollContainerRef.current;
       const newScrollHeight = container.scrollHeight;
       const diff = newScrollHeight - lastScrollHeightRef.current;
       
       if (diff > 0) {
         container.scrollTop = diff;
       }
       
       // Only reset the flag after we've actually seen a change in height or loading finished
       isAdjustmentNeededRef.current = false;
     }
   }, [loading, messages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isUserScrollingRef.current = false;
    setShowScrollButton(false);
  }, []);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setCurrentSearchIndex(0); return; }
    const query = searchQuery.toLowerCase();
    const results = messages.filter(msg => msg.content?.toLowerCase().includes(query)).map(msg => msg.id);
    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  }, [searchQuery, messages]);

  useEffect(() => {
    if (searchResults.length > 0 && currentSearchIndex >= 0) {
      const messageId = searchResults[currentSearchIndex];
      const element = messageRefs.current.get(messageId);
      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSearchIndex, searchResults]);

  useEffect(() => { if (showSearch) searchInputRef.current?.focus(); }, [showSearch]);

  const handleAIAgentSessionChange = useCallback((session: any) => {
    const active = !!(session && !session.human_takeover);
    setAiAgentActive(active);
    if (active) setShowExtras(false);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); navigateSearch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(""); }
  };

  const navigateSearch = (direction: number) => {
    if (searchResults.length === 0) return;
    let newIndex = currentSearchIndex + direction;
    if (newIndex >= searchResults.length) newIndex = 0;
    if (newIndex < 0) newIndex = searchResults.length - 1;
    setCurrentSearchIndex(newIndex);
  };

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded">{part}</mark>
      ) : part
    );
  };

  // Send message
  const handleSend = async () => {
    if (!messageText.trim() || sending) return;
    if (aiAgentActive) {
      toast.warning('A IA está ativa nesta conversa. Clique em "Assumir" no banner acima para assumir o controle antes de enviar.');
      return;
    }
    let text = messageText.trim();
    if (signMessages && user?.name) text = `*${user.name}*\n${text}`;
    const quotedId = replyingTo?.id;
    setMessageText(""); setReplyingTo(null);
    try { await onSendMessage(text, 'text', undefined, quotedId); }
    catch { setMessageText(messageText.trim()); }
  };

  // Slash command: detect /shortcut and load quick replies
  const slashCacheRef = useRef<QuickReply[]>([]);
  
  useEffect(() => {
    if (messageText.startsWith('/') && messageText.length >= 1) {
      const query = messageText.slice(1).toLowerCase();
      setSlashQuery(query);
      
      const loadAndFilter = async () => {
        if (slashCacheRef.current.length === 0) {
          try {
            const all = await fetchQuickRepliesForSlash();
            slashCacheRef.current = all;
          } catch { slashCacheRef.current = []; }
        }
        const filtered = slashCacheRef.current.filter(r => {
          const shortcut = (r.shortcut || '').toLowerCase();
          const title = (r.title || '').toLowerCase();
          return !query || shortcut.includes(query) || title.includes(query);
        }).slice(0, 8);
        setSlashReplies(filtered);
        setSlashSelectedIndex(0);
      };
      loadAndFilter();
    } else {
      setSlashQuery(null);
      setSlashReplies([]);
    }
  }, [messageText, fetchQuickRepliesForSlash]);

  const handleSlashSelect = useCallback((reply: QuickReply) => {
    const contactName = conversation?.contact_name || '';
    setMessageText(reply.content.replace(/\{nome\}/gi, contactName));
    setSlashQuery(null);
    setSlashReplies([]);
    textareaRef.current?.focus();
  }, [conversation?.contact_name]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    // Handle slash suggestions navigation
    if (slashQuery !== null && slashReplies.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelectedIndex(i => (i + 1) % slashReplies.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelectedIndex(i => (i - 1 + slashReplies.length) % slashReplies.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSlashSelect(slashReplies[slashSelectedIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashQuery(null); setSlashReplies([]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // File handling
  const inferMessageTypeFromFile = useCallback((file: File): 'image' | 'video' | 'audio' | 'document' => {
    const mime = String(file.type || '').toLowerCase();
    const ext = (() => { const parts = String(file.name || '').toLowerCase().split('.'); return parts.length > 1 ? `.${parts.pop()}` : ''; })();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    const videoExts = new Set(['.mp4', '.webm', '.ogg', '.mov', '.qt']);
    const audioExts = new Set(['.mp3', '.ogg', '.wav', '.webm', '.aac', '.m4a']);
    if (imageExts.has(ext)) return 'image';
    if (videoExts.has(ext)) return 'video';
    if (audioExts.has(ext)) return 'audio';
    return 'document';
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).map(file => {
      const inferredType = inferMessageTypeFromFile(file);
      const preview = inferredType === 'image' ? URL.createObjectURL(file) : undefined;
      return { file, preview };
    });
    setPendingFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Drag & Drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); dragCounterRef.current = 0; setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).map(file => {
      const inferredType = inferMessageTypeFromFile(file);
      const preview = inferredType === 'image' ? URL.createObjectURL(file) : undefined;
      return { file, preview };
    });
    setPendingFiles(prev => [...prev, ...newFiles]);
  }, [inferMessageTypeFromFile]);

  // Paste image from clipboard (Ctrl+V / Cmd+V)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) return;
        const preview = URL.createObjectURL(file);
        setPendingFiles(prev => [...prev, { file, preview }]);
        return;
      }
    }
  }, []);

  const looksLikeFilename = (value: string) => {
    const s = value.trim(); if (!s || s.length > 160) return false;
    // Check if it's a bracketed filename like [Documento: name.pdf] or [name.pdf]
    if (/^\[(?:Documento:\s*)?[^\]]+\.[a-z0-9]{2,6}\]$/i.test(s)) return true;
    return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|jpg|jpeg|png|gif|webp|mp3|ogg|wav|m4a|mp4|webm|mov)$/i.test(s);
  };

  const getDocumentDisplayName = (msg: ChatMessage, resolvedUrl?: string | null) => {
    let content = msg.content?.trim() || '';

    // Optimized extraction for filenames from common WhatsApp/Integration formats
    // Patterns: [Documento: name.xlsx], [name.xlsx], or sometimes just name.xlsx in content
    const bracketPattern = /\[(?:Documento:\s*)?([^\]]+\.[a-z0-9]{2,6})\]/i;
    const bracketMatch = content.match(bracketPattern);
    
    if (bracketMatch) {
      content = bracketMatch[1];
    } else {
      // If content itself looks like a filename (happens in some integrations)
      const directFileMatch = content.match(/^([^\]\s]+\.[a-z0-9]{2,6})$/i);
      if (directFileMatch) {
        content = directFileMatch[1];
      }
    }

    if (content && looksLikeFilename(content)) {
      return content;
    }
    
    // Fallback to URL parsing
    const raw = resolvedUrl || msg.media_url || '';
    if (!raw) return 'Documento';
    
    try {
      // Handle data URIs or blobs that might contain metadata
      if (raw.startsWith('data:') || raw.startsWith('blob:')) {
        return 'Documento';
      }

      const url = new URL(raw, window.location.origin);
      
      // Some APIs might provide the original name as a query parameter
      const urlParams = new URLSearchParams(url.search);
      const filenameParam = urlParams.get('filename') || urlParams.get('name') || urlParams.get('originalName');
      if (filenameParam) return decodeURIComponent(filenameParam);

      const last = url.pathname.split('/').filter(Boolean).pop();
      if (!last) return 'Documento';
      
      // Clean up common UUID-like prefixes if they seem to be prepended to the original name
      // e.g. "uuid_filename.xlsx" -> "filename.xlsx"
      let decoded = decodeURIComponent(last);
      
      // Handle the user's reported case: long hex strings (sha256/hex) prepended or as filename
      // e.g. "0698a3259c9ffaa9fb64f1ba79ece7eb66d0508a0c1a5d3bc0cfd80c82c1729a.pptx"
      // If the filename is just a long random hex string, we should use content if available
      const isLongHexString = /^[0-9a-f]{32,64}\.[a-z0-9]{2,6}$/i.test(decoded);
      if (isLongHexString && msg.content && looksLikeFilename(msg.content)) {
        // Re-extract from content if URL is just a hash
        const reMatch = msg.content.match(/\[(?:Documento:\s*)?([^\]]+\.[a-z0-9]{2,6})\]/i);
        if (reMatch) return reMatch[1];
        return msg.content.trim();
      }

      // Standard UUID pattern removal
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[_-]/i;
      if (uuidPattern.test(decoded)) {
        decoded = decoded.replace(uuidPattern, '');
      }
      
      return decoded || 'Documento';
    } catch { 
      const lastPart = String(raw).split('/').pop();
      return lastPart ? decodeURIComponent(lastPart) : 'Documento';
    }
  };

  const handleConfirmFileUpload = async () => {
    if (pendingFiles.length === 0) return;
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);
    let successCount = 0;
    setUploadStatus({ active: true, current: 0, total: filesToSend.length, fileName: filesToSend[0].file.name });
    for (let i = 0; i < filesToSend.length; i++) {
      const { file, preview } = filesToSend[i];
      setUploadStatus({ active: true, current: i + 1, total: filesToSend.length, fileName: file.name });
      try {
        // Small pause between files: providers (UAZAPI/W-API/Meta) frequently drop
        // media sent back-to-back in the same instant.
        if (i > 0) await new Promise((r) => setTimeout(r, 900));
        const url = await uploadFile(file);
        if (url) {
          const type = inferMessageTypeFromFile(file);
          const content = type === 'document' ? file.name : '';
          try {
            await onSendMessage(content, type, url, undefined, file.type);
            successCount++;
          } catch (sendError) {
            const msg = sendError instanceof Error ? sendError.message : 'Erro desconhecido';
            toast.error(`Erro ao enviar ${file.name}: ${msg}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        toast.error(`Erro ao enviar ${file.name}: ${errorMessage}`);
      } finally {
        if (preview) URL.revokeObjectURL(preview);
      }
    }
    if (successCount > 0) {
      toast.success(successCount === 1 ? "Arquivo enviado!" : `${successCount} arquivos enviados!`);
    }
    setUploadStatus(null);
    resetProgress();
  };

  const handleCancelFileUpload = () => {
    pendingFiles.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
    setPendingFiles([]); resetProgress();
  };

  const handleRemovePendingFile = (index: number) => {
    setPendingFiles(prev => {
      const removed = prev[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <Image className="h-8 w-8 text-green-500" />;
    if (mimeType.startsWith('video/')) return <Video className="h-8 w-8 text-purple-500" />;
    if (mimeType.startsWith('audio/')) return <Mic className="h-8 w-8 text-orange-500" />;
    if (mimeType.includes('pdf')) return <FileText className="h-8 w-8 text-red-500" />;
    return <FileText className="h-8 w-8 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Audio
  const handleSendAudio = async () => {
    if (!audioBlob) {
      console.warn("handleSendAudio: No audio blob available");
      return;
    }

    try {
      const cleanMimeType = audioBlob.type.split(';')[0] || 'audio/ogg';
      
      // Determine correct extension based on mime type
      let extension = 'ogg';
      if (cleanMimeType.includes('webm')) extension = 'webm';
      else if (cleanMimeType.includes('mp4')) extension = 'm4a';
      else if (cleanMimeType.includes('mpeg')) extension = 'mp3';
      else if (cleanMimeType.includes('wav')) extension = 'wav';

      const fileName = `audio-${Date.now()}.${extension}`;
      const file = new File([audioBlob], fileName, { type: cleanMimeType });
      
      console.log(`[Audio] Sending audio: ${fileName} (${cleanMimeType})`);
      
      setUploadStatus({ active: true, current: 1, total: 1, fileName: 'Áudio' });
      const url = await uploadFile(file);
      
      if (url) { 
        // Ensure duration is a valid number
        const validDuration = typeof duration === 'number' && !isNaN(duration) && duration > 0 ? Math.floor(duration) : 1;
        
        console.log(`[Audio] Uploaded successfully. URL: ${url}, Duration: ${validDuration}s`);
        
        await onSendMessage('', 'audio', url, undefined, cleanMimeType, validDuration); 
        toast.success("Áudio enviado!"); 
      }
      clearAudio();
    } catch (error) { 
      console.error("[Audio] Error sending audio:", error);
      toast.error("Erro ao enviar áudio"); 
    }
    finally { 
      setUploadStatus(null); 
      resetProgress(); 
    }
  };

  const handleStartRecording = async () => {
    try { await startRecording(); } catch { toast.error("Não foi possível acessar o microfone"); }
  };

  const handleStartTranscription = () => {
    if (!isSpeechSupported) { toast.error("Navegador não suporta reconhecimento de voz. Use Chrome, Edge ou Safari."); return; }
    startListening();
  };

  const handleStopTranscription = () => {
    const text = stopListening();
    if (text.trim()) setMessageText(prev => { const separator = prev.trim() ? ' ' : ''; return prev + separator + text.trim(); });
  };

  const handleEmojiSelect = useCallback((emoji: string) => {
    setMessageText(prev => prev + emoji); setShowEmojiPicker(false);
  }, []);

  // Department save
  const handleSaveDepartment = async (selectedDepartmentId: string) => {
    if (!conversation?.id) return;
    setSavingDepartment(true);
    try {
      const deptId = selectedDepartmentId === "__none__" ? null : (selectedDepartmentId || null);
      if (deptId) {
        const success = await transferToDepartment(conversation.id, deptId);
        if (success) { toast.success("Departamento atribuído!"); onDepartmentChange?.(deptId); }
        else toast.error("Erro ao atribuir departamento");
      } else {
        await api(`/api/chat/conversations/${conversation.id}/department`, { method: 'DELETE', auth: true });
        toast.success("Departamento removido"); onDepartmentChange?.(null);
      }
      setShowDepartmentDialog(false);
    } catch { toast.error("Erro ao salvar departamento"); }
    finally { setSavingDepartment(false); }
  };

  const getInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-muted/30 text-muted-foreground h-full min-h-0">
        <div className="flex flex-col items-center justify-center text-center -mt-12">
          <img 
            src="/icons/gleego-logo.png" 
            alt="Logo" 
            className="h-32 w-auto mb-8 opacity-80"
          />
          <h3 className="text-xl font-semibold text-foreground mb-3">Selecione uma conversa</h3>
          <p className="text-sm text-muted-foreground max-w-[300px]">Escolha uma conversa na lista à esquerda para começar a atender</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex-1 flex h-full min-w-0 overflow-x-hidden overflow-y-hidden relative max-w-full"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 text-primary">
            <Upload className="h-12 w-12" />
            <span className="text-lg font-medium">Solte o arquivo aqui</span>
            <span className="text-sm text-muted-foreground">Imagens, vídeos, documentos, áudios...</span>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full min-w-0 overflow-x-hidden">
      {/* Archived Banner */}
      {conversation.is_archived && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-600 dark:text-amber-400">
          <Archive className="h-4 w-4" />
          <span className="text-sm font-medium">Esta conversa está arquivada</span>
          <Button variant="ghost" size="sm" className="ml-2 h-6 px-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/20" onClick={onArchive}>Desarquivar</Button>
        </div>
      )}

      {/* Header */}
      <div className={cn("border-b bg-card flex-shrink-0 transition-all duration-300", 
        isMobile ? "flex items-center gap-2 pl-16 pr-2 py-2 pt-16" : cn("flex items-center justify-between", showHeaderInfo ? "p-4" : "p-2"))}>
        <div className={cn("flex items-center gap-2 min-w-0 flex-1", isMobile && "overflow-hidden")}>
          {isMobile && onMobileBack && (
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onMobileBack}><ArrowLeft className="h-5 w-5" /></Button>
          )}
          
          {!isMobile && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 flex-shrink-0 mr-1 text-muted-foreground hover:text-foreground" 
              onClick={() => setShowHeaderInfo(!showHeaderInfo)}
              title={showHeaderInfo ? "Recolher informações" : "Expandir informações"}
            >
              {showHeaderInfo ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          )}

          {showHeaderInfo ? (
            <>
          <Avatar className={cn(isMobile ? "h-8 w-8" : "h-10 w-10", "flex-shrink-0")}>
            {profilePictureUrl && !conversation.is_group && (
              <AvatarImage src={profilePictureUrl} alt={conversation.contact_name || 'Avatar'} className="object-cover" />
            )}
            <AvatarFallback className={cn("text-primary", conversation.is_group ? "bg-blue-100 dark:bg-blue-900/30" : "bg-primary/10")}>
              {conversation.is_group ? <Users className={cn(isMobile ? "h-4 w-4" : "h-5 w-5")} /> : getInitials(conversation.contact_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className={cn("font-semibold truncate", isMobile && "text-sm")}>
                {conversation.is_group ? (conversation.group_name || 'Grupo sem nome') : (conversation.contact_name || conversation.contact_phone || 'Desconhecido')}
              </h3>
               {(conversation.automation_active || (conversation as any).active_flow) && (
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <ZapIcon className={cn("h-3.5 w-3.5 flex-shrink-0 fill-current", (conversation as any).active_flow ? "text-blue-500" : "text-purple-500 animate-pulse")} />
                   </TooltipTrigger>
                   <TooltipContent side="bottom" className="max-w-[300px]">
                     {(conversation as any).active_flow ? (
                       <div className="space-y-1 py-1">
                         <p className="font-semibold text-xs flex items-center gap-1">
                           <ZapIcon className="h-3 w-3" /> Fluxo Ativo: {(conversation as any).active_flow.flow_name}
                         </p>
                         <p className="text-xs opacity-90 italic">Etapa atual: {(conversation as any).active_flow.node_name || 'Início'}</p>
                         <div className="flex flex-col gap-1.5 pt-1 mt-1 border-t border-border/50">
                           {(conversation as any).active_flow.wait_reply_expires_at && (
                             <p className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                               <Clock className="h-2.5 w-2.5" /> Aguardando resposta...
                             </p>
                           )}
                           <Button 
                             variant="destructive" 
                             size="sm" 
                             className="h-6 text-[10px] w-full"
                             onClick={async (e) => {
                               e.stopPropagation();
                               if (window.confirm("Deseja realmente cancelar este fluxo ativo?")) {
                                 const ok = await cancelActiveFlow(conversation.id);
                                 if (ok) {
                                   toast.success("Fluxo cancelado com sucesso");
                                   onLoadMore(); // Force refresh to update status
                                 } else {
                                   toast.error("Falha ao cancelar fluxo");
                                 }
                               }
                             }}
                           >
                             Cancelar Fluxo
                           </Button>
                         </div>
                       </div>
                     ) : (
                       <p>Automação ativa aguardando resposta</p>
                     )}
                   </TooltipContent>
                 </Tooltip>
               )}
            </div>
            {isMobile ? (
              <p className="text-[11px] text-muted-foreground truncate">{conversation.is_group ? 'Grupo' : conversation.contact_phone}</p>
            ) : conversation.is_group ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-wrap">
                <Users className="h-3 w-3" /><span>Grupo</span><span className="opacity-50">•</span>
                <span className="truncate max-w-[160px]">{conversation.connection_name}</span>
              </div>
            ) : (
              <button onClick={() => setShowEditContactDialog(true)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer min-w-0 flex-wrap" title="Clique para editar o nome do contato">
                <Phone className="h-3 w-3" /><span className="hover:underline whitespace-nowrap">{conversation.contact_phone}</span>
                <PenLine className="h-3 w-3 opacity-50" /><span className="opacity-50">•</span>
                <span className="truncate max-w-[160px]">{conversation.connection_name}</span>
              </button>
            )}
          </div>
            </>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:opacity-80" onClick={() => setShowHeaderInfo(true)}>
              <Avatar className="h-6 w-6 flex-shrink-0">
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                  {conversation.is_group ? <Users className="h-3 w-3" /> : getInitials(conversation.contact_name)}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium text-sm truncate">
                {conversation.is_group ? (conversation.group_name || 'Grupo') : (conversation.contact_name || conversation.contact_phone)}
              </span>
            </div>
          )}
        </div>

        {/* Header actions */}
        <div className={cn("flex items-center flex-shrink-0", isMobile ? "gap-0.5" : "gap-2")}>
          {!isMobile && (
            <>
              {!isViewOnly && onReleaseConversation && conversation.attendance_status === 'attending' && (
                <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950 h-8" onClick={onReleaseConversation} title="Liberar conversa">
                  <Undo2 className="h-3.5 w-3.5 mr-1" />Liberar
                </Button>
              )}
              {!isViewOnly && onFinishConversation && (conversation.attendance_status === 'attending' || conversation.attendance_status === 'waiting') && (
                <Button variant="outline" size="icon" className="text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950 h-8 w-8" onClick={onFinishConversation} title="Finalizar atendimento">
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
              {!isViewOnly && onReopenConversation && conversation.attendance_status === 'finished' && (
                <Button variant="outline" size="sm" className="text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950 h-8" onClick={onReopenConversation} title="Reabrir conversa">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />Reabrir
                </Button>
              )}
            </>
          )}
          
          {isMobile && onOpenCRM && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpenCRM} title="Abrir CRM"><Briefcase className="h-3.5 w-3.5" /></Button>
          )}

          <Button variant="ghost" size="icon" className={cn(showSearch && "bg-muted", isMobile ? "h-7 w-7" : "h-8 w-8")} onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(""); }} title="Buscar mensagens">
            <Search className={cn(isMobile ? "h-3.5 w-3.5" : "h-4 w-4")} />
          </Button>

          {!isMobile && messages.length > 3 && showHeaderInfo && <SentimentIndicator messages={messages} compact />}

          {!isMobile && showHeaderInfo && (
            <div className="flex items-center gap-1">
              {(Array.isArray(conversation.tags) ? conversation.tags : []).slice(0, 3).map(tag => (
                <Badge key={tag.id} variant="outline" className="cursor-pointer text-xs" style={{ borderColor: tag.color, color: tag.color }} onClick={() => onRemoveTag(tag.id)} title="Clique para remover">
                  {tag.name}<X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}

          {!isMobile && onOpenCRM && (
            <>
              {!conversation.is_group && Array.isArray(openDeals) && openDeals.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="text-primary border-primary/30 hover:bg-primary/10 relative h-8" title={`${openDeals.length} negociação(ões) aberta(s)`}>
                      <Briefcase className="h-3.5 w-3.5" /><span className="ml-1.5 text-xs">CRM</span>
                      <Badge variant="secondary" className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 text-[10px] bg-primary text-primary-foreground">{openDeals.length}</Badge>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72 z-[80]">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Negociações abertas</div>
                    <DropdownMenuSeparator />
                    {openDeals.slice(0, 5).map(deal => (
                      <DropdownMenuItem key={deal.id} onClick={() => { setSelectedDeal(deal); setShowDealDetailDialog(true); }} className="flex flex-col items-start gap-1 py-2">
                        <div className="flex items-center gap-2 w-full">
                          <span className="font-medium truncate flex-1">{deal.title}</span>
                          {deal.stage_color && <Badge variant="outline" className="text-[10px] h-5 px-1.5" style={{ borderColor: deal.stage_color, color: deal.stage_color }}>{deal.stage_name}</Badge>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{deal.company_name}</span><span>•</span>
                          <span className="font-medium text-foreground">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(deal.value)}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onOpenCRM} className="text-primary">
                      <Briefcase className="h-4 w-4 mr-2" />Abrir painel CRM completo
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="outline" size="sm" className="text-primary border-primary/30 hover:bg-primary/10 h-8" onClick={onOpenCRM} title="Abrir painel CRM">
                  <Briefcase className="h-3.5 w-3.5" /><span className="ml-1.5 text-xs">CRM</span>
                </Button>
              )}
            </>
          )}

          {!isMobile && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><Tag className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[80] max-h-[60vh] overflow-y-auto">
                {tags.filter(t => !(Array.isArray(conversation.tags) ? conversation.tags : []).some(ct => ct.id === t.id)).map(tag => (
                  <DropdownMenuItem key={tag.id} onClick={() => onAddTag(tag.id)}>
                    <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: tag.color }} />{tag.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowTagDialog(true)}><Plus className="h-4 w-4 mr-2" />Nova tag</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!isMobile && !isViewOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><UserPlus className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[80]">
                <DropdownMenuItem onClick={() => onAssign(null)}><X className="h-4 w-4 mr-2" />Remover atendente</DropdownMenuItem>
                <DropdownMenuSeparator />
                {(Array.isArray(team) ? team : []).map(member => (
                  <DropdownMenuItem key={member.id} onClick={() => onAssign(member.id)}>
                    {member.name}{conversation.assigned_to === member.id && <Check className="h-4 w-4 ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* More options menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={cn(isMobile ? "h-7 w-7" : "h-8 w-8")}><MoreVertical className={cn(isMobile ? "h-3.5 w-3.5" : "h-4 w-4")} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[80] max-h-[70vh] overflow-y-auto">
              {isMobile && (
                <>
                  {!isViewOnly && onReleaseConversation && conversation.attendance_status === 'attending' && (
                    <DropdownMenuItem onClick={onReleaseConversation} className="text-amber-600"><Undo2 className="h-4 w-4 mr-2" />Liberar conversa</DropdownMenuItem>
                  )}
                  {!isViewOnly && onFinishConversation && (conversation.attendance_status === 'attending' || conversation.attendance_status === 'waiting') && (
                    <>
                      <DropdownMenuItem onClick={onFinishConversation} className="text-green-600"><Check className="h-4 w-4 mr-2" />Finalizar atendimento</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => finishWithSummary.mutate(conversation.id)} disabled={finishWithSummary.isPending} className="text-primary">
                        {finishWithSummary.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}Finalizar + Resumo IA
                      </DropdownMenuItem>
                    </>
                  )}
                  {!isViewOnly && onReopenConversation && conversation.attendance_status === 'finished' && (
                    <DropdownMenuItem onClick={onReopenConversation} className="text-blue-600"><RotateCcw className="h-4 w-4 mr-2" />Reabrir conversa</DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              
               <DropdownMenuLabel className="text-[10px] uppercase font-bold opacity-50 px-2 py-1">Histórico Local</DropdownMenuLabel>
               {[
                 { label: 'Exibir Tudo', value: 0 },
                 { label: '7 dias', value: 7 },
                 { label: '30 dias', value: 30 },
                 { label: '90 dias', value: 90 },
                 { label: '365 dias', value: 365 }
               ].filter(Boolean).map(opt => (
                 <DropdownMenuItem key={opt.value} onClick={() => {
                   setHistoryDays(opt.value);
                   toast.success(opt.value === 0 ? "Exibindo todo o histórico disponível" : `Exibindo mensagens dos últimos ${opt.value} dias`);
                   window.dispatchEvent(new CustomEvent('refresh-history-days', { detail: { days: opt.value } }));
                 }}>
                   <div className="flex items-center justify-between w-full text-xs">
                     <span>{opt.label}</span>
                     {historyDays === opt.value && <Check className="h-3 w-3" />}
                   </div>
                 </DropdownMenuItem>
               ))}
              <DropdownMenuSeparator />
              {!conversation.is_group && !isViewOnly && <DropdownMenuItem onClick={() => setShowCallDialog(true)}><Phone className="h-4 w-4 mr-2" />Chamada de voz</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => setShowNotes(!showNotes)}>
                <StickyNote className="h-4 w-4 mr-2" />Anotações internas
                {notesCount > 0 && <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">{notesCount}</Badge>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSummaryPanel(!showSummaryPanel)}>
                <Sparkles className="h-4 w-4 mr-2" />Resumo IA
                {(conversation as any).ai_sentiment && <SummaryBadge sentiment={(conversation as any).ai_sentiment} className="ml-auto" />}
              </DropdownMenuItem>
              {!isViewOnly && conversation.attendance_status === 'finished' && !(conversation as any).ai_summary && (
                <DropdownMenuItem onClick={() => generateSummary.mutate(conversation.id)} disabled={generateSummary.isPending}>
                  {generateSummary.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}Gerar Resumo IA
                </DropdownMenuItem>
              )}
              {!isViewOnly && !isMobile && onFinishConversation && (conversation.attendance_status === 'attending' || conversation.attendance_status === 'waiting') && (
                <DropdownMenuItem onClick={() => finishWithSummary.mutate(conversation.id)} disabled={finishWithSummary.isPending} className="text-primary">
                  {finishWithSummary.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}Finalizar + Resumo IA
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setSignMessages(!signMessages); }}>
                <PenLine className="h-4 w-4 mr-2" />{signMessages ? 'Desativar assinatura' : 'Ativar assinatura'}
              </DropdownMenuItem>
              {conversation.is_group && notifSettings.muteGroups ? (
                <DropdownMenuItem onClick={() => {
                  const allowed = notifSettings.allowedGroups || [];
                  const isAllowed = allowed.includes(conversation.id);
                  const next = isAllowed ? allowed.filter(id => id !== conversation.id) : [...allowed, conversation.id];
                  updateNotifSettings({ allowedGroups: next });
                  toast.success(isAllowed ? 'Grupo voltou a ser silenciado' : 'Notificações deste grupo ativadas');
                }}>
                  {(notifSettings.allowedGroups || []).includes(conversation.id)
                    ? (<><BellOff className="h-4 w-4 mr-2" />Silenciar este grupo</>)
                    : (<><Bell className="h-4 w-4 mr-2" />Reativar notificações</>)}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => { toggleConversationMute(conversation.id); toast.success(isConversationMuted(conversation.id) ? 'Notificações ativadas' : 'Conversa silenciada'); }}>
                  {isConversationMuted(conversation.id) ? <Bell className="h-4 w-4 mr-2" /> : <BellOff className="h-4 w-4 mr-2" />}
                  {isConversationMuted(conversation.id) ? 'Ativar notificações' : 'Silenciar conversa'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Exportar conversa</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => { exportConversationAsTxt(conversation, messages); toast.success("Conversa exportada como TXT"); }}>
                <Download className="h-4 w-4 mr-2" />Exportar TXT
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { exportConversationAsPdf(conversation, messages); toast.success("Preparando PDF para impressão..."); }}>
                <FileText className="h-4 w-4 mr-2" />Exportar PDF
              </DropdownMenuItem>
              {!isViewOnly && (
                <>
                  <DropdownMenuSeparator />
                  {modulesEnabled.crm && <DropdownMenuItem onClick={() => setShowDealDialog(true)}><Briefcase className="h-4 w-4 mr-2" />Negociações (CRM)</DropdownMenuItem>}
                  {modulesEnabled.doc_signatures && !conversation.is_group && <DropdownMenuItem onClick={() => setShowSignatureDialog(true)}><FileSignature className="h-4 w-4 mr-2" />Solicitar Assinatura</DropdownMenuItem>}
                  <DropdownMenuItem onClick={() => setShowStartFlowDialog(true)}><Bot className="h-4 w-4 mr-2" />Iniciar fluxo de chatbot</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowTransferDialog(true)}><ArrowLeftRight className="h-4 w-4 mr-2" />Transferir atendimento</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDepartmentDialog(true)}>
                    <Building2 className="h-4 w-4 mr-2" />Atribuir departamento
                    {conversation.department_name && <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5">{conversation.department_name}</Badge>}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onArchive}><Archive className="h-4 w-4 mr-2" />{conversation.is_archived ? 'Desarquivar' : 'Arquivar'}</DropdownMenuItem>
                </>
              )}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setShowDeleteDialog(true)}>
                    <Trash2 className="h-4 w-4 mr-2" />Excluir conversa
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* AI Agent Banner - always visible so takeover/reactivation state is clear */}
      {!conversation.is_group && (
        <AIAgentBanner conversationId={conversation.id} isGroup={conversation.is_group} onSessionChange={handleAIAgentSessionChange} />
      )}

      {/* Mobile Quick Actions */}
      {isMobile && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/20 overflow-x-auto flex-shrink-0">
          {onOpenCRM && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-shrink-0 border-primary/30 text-primary" onClick={onOpenCRM}><Briefcase className="h-3 w-3" />CRM</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-shrink-0 border-violet-400/50 text-violet-600 dark:text-violet-400" onClick={onOpenCRM}><Sparkles className="h-3 w-3" />IA Consulta</Button>
            </>
          )}
          {!isViewOnly && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-shrink-0" onClick={() => setShowTransferDialog(true)}><ArrowLeftRight className="h-3 w-3" />Transferir</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 flex-shrink-0">
                <Tag className="h-3 w-3" />Tags
                {(Array.isArray(conversation.tags) ? conversation.tags : []).length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">{conversation.tags.length}</Badge>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[80] max-h-[60vh] overflow-y-auto">
              {tags.filter(t => !(Array.isArray(conversation.tags) ? conversation.tags : []).some(ct => ct.id === t.id)).map(tag => (
                <DropdownMenuItem key={tag.id} onClick={() => onAddTag(tag.id)}>
                  <div className="w-3 h-3 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: tag.color }} />{tag.name}
                </DropdownMenuItem>
              ))}
              {(Array.isArray(conversation.tags) ? conversation.tags : []).length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">Remover tag</DropdownMenuLabel>
                  {conversation.tags.map(tag => (
                    <DropdownMenuItem key={tag.id} onClick={() => onRemoveTag(tag.id)}>
                      <div className="w-3 h-3 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: tag.color }} />{tag.name}<X className="h-3 w-3 ml-auto text-muted-foreground" />
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowTagDialog(true)}><Plus className="h-4 w-4 mr-2" />Nova tag</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/50">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input ref={searchInputRef} placeholder="Buscar nas mensagens..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={handleSearchKeyDown} className="h-8 text-sm" />
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{currentSearchIndex + 1}/{searchResults.length}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateSearch(-1)}><ChevronUp className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateSearch(1)}><ChevronDown className="h-3 w-3" /></Button>
            </div>
          )}
          {searchQuery && searchResults.length === 0 && <span className="text-xs text-muted-foreground">Nenhum resultado</span>}
          <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => { setShowSearch(false); setSearchQuery(""); }}><X className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Pinned Message Banner */}
      {pinnedMessage && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
          onClick={() => {
            const el = messageRefs.current.get(pinnedMessage.id);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          <Pin className="h-4 w-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-primary">Mensagem fixada</span>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {pinnedMessage.message_type !== 'text'
                ? (pinnedMessage.message_type === 'image' ? '📷 Imagem' : pinnedMessage.message_type === 'video' ? '🎥 Vídeo' : pinnedMessage.message_type === 'audio' ? '🎤 Áudio' : '📄 Documento')
                : pinnedMessage.content}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await pinMessage(conversation.id, null);
              if (ok) {
                setPinnedMessage(null);
                toast.success("Mensagem desafixada");
              }
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Messages - Added overflow-y-auto to the viewport via style for sticky positioning support */}
      <ScrollArea ref={scrollAreaRef} viewportRef={scrollContainerRef} className={cn("flex-1 chat-wallpaper min-w-0 relative", isMobile ? "p-3" : "p-4")}>
         {hasMore ? (
           <div className="flex justify-center mb-4">
             <Button variant="ghost" size="sm" onClick={() => {
               if (scrollContainerRef.current) {
                 lastScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
                 isAdjustmentNeededRef.current = true;
               }
               onLoadMore();
             }} disabled={loading}>
               {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Carregar anteriores'}
             </Button>
           </div>
         ) : !loading && conversation && (
           <div className="flex flex-col items-center gap-2 mb-8 mt-4">
             <div className="h-px w-full max-w-[200px] bg-border/50" />
             <p className="text-xs text-muted-foreground italic">Início das mensagens locais</p>
             {onSyncHistory && (
               <Button 
                 variant="outline" 
                 size="sm" 
                 onClick={() => setShowSyncDialog(true)}
                 className="h-8 gap-2"
               >
                 <RotateCcw className="h-3.5 w-3.5" />
                 Sincronizar histórico do WhatsApp
               </Button>
             )}
           </div>
         )}
         <div className="flex flex-col gap-4">
           {messages.map((msg, index) => {
             const prevMsg = index > 0 ? messages[index - 1] : null;
             const currentDate = msg.timestamp ? parseISO(msg.timestamp) : null;
             const prevDate = prevMsg?.timestamp ? parseISO(prevMsg.timestamp) : null;
             const showDateDivider = currentDate && (!prevDate || !isSameDay(currentDate, prevDate));
 
              const dateLabel = showDateDivider && currentDate ? format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR }) : null;
              
              return (
                <div key={msg.id} className="flex flex-col gap-4 relative">
                 {showDateDivider && (
                   <div className="sticky top-0 z-[20] flex items-center justify-center py-4 pointer-events-none">
                     <div className="px-3 py-1.5 rounded-full bg-background/95 backdrop-blur-sm text-[10px] font-bold text-muted-foreground uppercase tracking-wider shadow-md pointer-events-auto border border-primary/20">
                       {dateLabel}
                     </div>
                   </div>
                 )}
                 <ChatMessageBubble
                   msg={msg}
                   conversation={conversation}
                   isMobile={isMobile}
                   isSearchResult={searchResults.includes(msg.id)}
                   isCurrentResult={searchResults[currentSearchIndex] === msg.id}
                    searchQuery={searchQuery}
                    onRetryMediaDownload={async (messageId) => {
                      try {
                        const result = await retryMediaDownload(messageId);
                        if (result.success) {
                          onLoadMore(); // This refreshes the message list
                          return true;
                        }
                        return false;
                      } catch {
                        return false;
                      }
                    }}

                   onReply={setReplyingTo}
                   onForward={onForwardMessage ? (msg) => setForwardingMessage(msg) : undefined}
                   onSendMessage={onSendMessage}
                   onEditMessage={async (messageId, content) => {
                     const ok = await editMessage(conversation.id, messageId, content);
                     if (ok) {
                       const updatedMessages = messages.map(m => 
                         m.id === messageId ? { ...m, content, is_edited: true } : m
                       );
                       onLoadMore();
                     }
                     return ok;
                   }}
                   onDeleteMessage={async (messageId) => {
                     const ok = await deleteMessageFn(conversation.id, messageId);
                     if (ok) {
                       onLoadMore();
                     }
                     return ok;
                   }}
                   onPinMessage={async (messageId) => {
                     const ok = await pinMessage(conversation.id, messageId);
                     if (ok) {
                       if (messageId) {
                         const msg = messages.find(m => m.id === messageId);
                         setPinnedMessage(msg || null);
                       } else {
                         setPinnedMessage(null);
                       }
                     }
                     return ok;
                   }}
                   isPinned={conversation.pinned_message_id === msg.id}
                   highlightText={highlightText}
                   getDocumentDisplayName={getDocumentDisplayName}
                   looksLikeFilename={looksLikeFilename}
                   messageRef={(el) => { if (el) messageRefs.current.set(msg.id, el); }}
                 />
               </div>
             );
           })}
          {isContactTyping && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg p-3"><TypingIndicator contactName={conversation?.contact_name} /></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {showScrollButton && (
          <Button variant="secondary" size="icon" className="absolute bottom-4 right-4 h-10 w-10 rounded-full shadow-lg z-10 bg-card border hover:bg-accent" onClick={scrollToBottom}>
            <ChevronDown className="h-5 w-5" />
          </Button>
        )}
      </ScrollArea>

      {/* Input area */}
      {isViewOnly ? (
        <div className="p-4 border-t bg-muted/50">
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-3">
            <Users className="h-5 w-5" /><span className="text-sm font-medium">Modo Supervisor - Apenas visualização</span>
          </div>
        </div>
      ) : (
      <div className={cn("border-t bg-card", isMobile ? "p-3" : "p-4")}>
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-muted border-l-4 border-primary">
            <Reply className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-primary">Respondendo a {replyingTo.from_me ? 'você mesmo' : (conversation?.contact_name || 'Contato')}</div>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {replyingTo.message_type !== 'text' ? (
                  <span className="italic">
                    {replyingTo.message_type === 'image' && '📷 Imagem'}
                    {replyingTo.message_type === 'video' && '🎥 Vídeo'}
                    {replyingTo.message_type === 'audio' && '🎤 Áudio'}
                    {replyingTo.message_type === 'document' && '📄 Documento'}
                  </span>
                ) : replyingTo.content}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => setReplyingTo(null)}><X className="h-4 w-4" /></Button>
          </div>
        )}

        {/* Toggle for extras (sign messages + AI suggestions + AI agent banner) */}
        <div className="flex items-center justify-end -mt-1 mb-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setShowExtras(v => !v)}
            title={showExtras ? "Ocultar opções" : "Mostrar opções"}
          >
            {showExtras ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            {showExtras ? "Ocultar opções" : "Opções"}
            {signMessages && !showExtras && <PenLine className="h-3 w-3 text-primary ml-1" />}
          </Button>
        </div>

        {showExtras && (
          <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Checkbox id="sign-messages" checked={signMessages} onCheckedChange={checked => setSignMessages(checked === true)} />
              <Label htmlFor="sign-messages" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1 min-w-0">
                <PenLine className="h-3 w-3" />Assinar mensagens {user?.name && signMessages && <span className="text-primary">(*{user.name}*)</span>}
              </Label>
            </div>

            {!isMobile && messages.length > 5 && (
              <div className="mb-3">
                <ActionSuggestions messages={messages} conversationData={{ lastMessageAt: conversation?.last_message_at || undefined, attendanceStatus: conversation?.attendance_status, tags: conversation?.tags }}
                  onScheduleMessage={() => setShowScheduleDialog(true)}
                  onScheduleMeeting={() => { modulesEnabled.crm ? setShowDealDialog(true) : setShowScheduleDialog(true); }}
                  onOpenCRM={() => setShowDealDialog(true)}
                  onSendQuickReply={() => setShowQuickReplies(true)}
                  compact
                />
              </div>
            )}
          </>
        )}
        
        <input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar" onChange={handleFileSelect} />

        {pendingFiles.length > 0 && (
          <div className="mb-3 p-3 rounded-lg border bg-muted/50 animate-in fade-in slide-in-from-bottom-2 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {pendingFiles.length} arquivo{pendingFiles.length > 1 ? 's' : ''} selecionado{pendingFiles.length > 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={handleCancelFileUpload} disabled={isUploading}>
                  Cancelar tudo
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={handleConfirmFileUpload} disabled={isUploading || sending}>
                  {isUploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                  Enviar {pendingFiles.length > 1 ? `(${pendingFiles.length})` : ''}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {pendingFiles.map((pf, idx) => (
                <div key={idx} className="relative group flex items-center gap-2 p-2 rounded-md border bg-background min-w-0 max-w-[200px]">
                  <div className="flex-shrink-0">
                    {pf.preview ? (
                      <div className="w-10 h-10 rounded overflow-hidden bg-muted"><img src={pf.preview} alt="Preview" className="w-full h-full object-cover" /></div>
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">{getFileIcon(pf.file.type)}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{pf.file.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatFileSize(pf.file.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-1 -right-1 bg-background border shadow-sm" onClick={() => handleRemovePendingFile(idx)} disabled={isUploading}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            {isUploading && <div className="space-y-1"><Progress value={uploadProgress} className="h-2" /><p className="text-xs text-muted-foreground text-right">{uploadProgress}%</p></div>}
          </div>
        )}

        {/* Floating upload progress bar (visible when pendingFiles already cleared) */}
        {uploadStatus?.active && pendingFiles.length === 0 && (
          <div className="mb-3 p-3 rounded-lg border bg-muted/50 animate-in fade-in slide-in-from-bottom-2 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="text-xs font-medium">
                  Enviando {uploadStatus.fileName}
                  {uploadStatus.total > 1 && ` (${uploadStatus.current}/${uploadStatus.total})`}
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        {isListening ? (
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={cancelListening}><Trash2 className="h-5 w-5" /></Button>
            <div className="flex-1 flex flex-col gap-1 px-4 py-2 bg-primary/10 rounded-lg border border-primary/30 overflow-hidden">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-primary animate-pulse flex-shrink-0" /><span className="text-xs font-medium text-primary">Ouvindo...</span></div>
              <p className="text-sm text-foreground min-h-[1.5rem] line-clamp-2">{fullTranscript || <span className="text-muted-foreground italic">Fale algo...</span>}</p>
            </div>
            <Button size="icon" className="h-10 w-10 flex-shrink-0" onClick={handleStopTranscription}><Check className="h-5 w-5" /></Button>
          </div>
        ) : isRecording ? (
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={cancelRecording}><Trash2 className="h-5 w-5" /></Button>
            <div className="flex-1 flex items-center gap-3 px-4 py-2 bg-destructive/10 rounded-lg border border-destructive/30 overflow-hidden">
              <div className="w-3 h-3 rounded-full bg-destructive animate-pulse flex-shrink-0" />
              <div className="flex-1 flex items-center justify-center"><AudioWaveform levels={audioLevels} /></div>
              <span className="text-sm font-mono text-destructive/80 flex-shrink-0">{formatDuration(duration)}</span>
            </div>
            <Button size="icon" className="h-10 w-10 flex-shrink-0 bg-destructive hover:bg-destructive/90" onClick={stopRecording}><Square className="h-4 w-4 fill-current" /></Button>
          </div>
        ) : audioBlob ? (
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={clearAudio}><Trash2 className="h-5 w-5" /></Button>
            <div className="flex-1 flex items-center gap-3 px-4 py-2 bg-primary/10 rounded-lg border border-primary/30">
              <Mic className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Áudio gravado</span>
              <span className="text-sm font-mono text-muted-foreground">{formatDuration(duration)}</span>
            </div>
            <Button size="icon" className="h-10 w-10 flex-shrink-0" onClick={handleSendAudio} disabled={sending || isUploading || !audioBlob}>
              {(sending || isUploading) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        ) : (
          <div className={cn("flex flex-col gap-2", !isMobile && "flex-row items-end")}>
            <div className="flex items-center gap-1">
              {isMetaConnection && (
                <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 text-primary" onClick={() => setShowTemplateDialog(true)} title="Enviar Template Meta">
                  <FileText className="h-4 w-4" />
                </Button>
              )}
              {isUazapiConnection && (
                <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 text-primary" onClick={() => setShowInteractiveMenuDialog(true)} title="Enviar Menu Interativo">
                  <LayoutList className="h-4 w-4" />
                </Button>
              )}
               <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setShowStartFlowDialog(true)} title="Iniciar fluxo"><ZapIcon className="h-4 w-4 text-primary" /></Button>
      {conversation && (
        <SendInteractiveMenuDialog
          open={showInteractiveMenuDialog}
          onOpenChange={setShowInteractiveMenuDialog}
          onSend={async (text, buttons, footer, image) => {
            const payload = JSON.stringify({ text, buttons, footer, image });
            await (onSendMessage as any)(payload, 'interactive_menu');
            toast.success('Menu interativo enviado!');
          }}
        />
      )}

              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setShowQuickReplies(!showQuickReplies)} title="Respostas rápidas"><Reply className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => fileInputRef.current?.click()} disabled={isUploading || sending}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => setShowSendContactDialog(true)} title="Enviar contato">
                <ContactIcon className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className={cn("h-9 w-9 flex-shrink-0 relative", scheduledMessages.length > 0 && "text-primary")} onClick={() => setShowScheduleDialog(true)} title="Agendar mensagem">
                <CalendarClock className="h-4 w-4" />
                {scheduledMessages.length > 0 && <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{scheduledMessages.length}</span>}
              </Button>
              <EmojiPicker isOpen={showEmojiPicker} onToggle={() => setShowEmojiPicker(!showEmojiPicker)} onClose={() => setShowEmojiPicker(false)} onEmojiSelect={handleEmojiSelect} />
            </div>
            <div className="flex items-end gap-2 flex-1">
              <div className="relative flex-1">
                <Textarea ref={textareaRef} placeholder="Digite uma mensagem... Use @ para mencionar" value={messageText} onChange={e => setMessageText(e.target.value)}
                  spellCheck
                  lang="pt-BR"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  autoComplete="on"
                  onKeyDown={e => { if ((showMentionSuggestions || (slashQuery !== null && slashReplies.length > 0)) && ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) { handleKeyPress(e); return; } handleKeyPress(e); }}
                  onPaste={handlePaste}
                   className={cn("resize-none", isMobile ? "!min-h-[80px] max-h-[160px] text-base leading-6" : "min-h-[40px] max-h-[120px]")}
                   rows={isMobile ? 3 : 1}
                   style={isMobile ? { height: 'auto', minHeight: '80px' } : undefined} />
                {showMentionSuggestions && <MentionSuggestions query={mentionQuery} team={team} onSelect={handleSelectMember} onClose={closeSuggestions} position={suggestionPosition} />}
                {slashQuery !== null && slashReplies.length > 0 && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Respostas rápidas</div>
                      {slashReplies.map((reply, idx) => (
                        <button
                          key={reply.id}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-md text-sm flex flex-col gap-0.5 transition-colors",
                            idx === slashSelectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                          )}
                          onMouseDown={(e) => { e.preventDefault(); handleSlashSelect(reply); }}
                          onMouseEnter={() => setSlashSelectedIndex(idx)}
                        >
                          <span className="font-medium">/{reply.shortcut || reply.title}</span>
                          <span className="text-xs text-muted-foreground line-clamp-1">{reply.content}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {messageText.trim() ? (
                <Button size="icon" className="h-10 w-10 flex-shrink-0" onClick={handleSend} disabled={!messageText.trim() || sending}>
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  {isSpeechSupported && <Button size="icon" variant="ghost" className="h-10 w-10 flex-shrink-0" onClick={handleStartTranscription} title="Transcrever voz"><MessageSquare className="h-5 w-5" /></Button>}
                  <Button size="icon" variant="secondary" className="h-10 w-10 flex-shrink-0" onClick={handleStartRecording} title="Gravar áudio"><Mic className="h-5 w-5" /></Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Dialogs */}
      <ScheduleMessageDialog
        open={showScheduleDialog} onOpenChange={setShowScheduleDialog} scheduledMessages={scheduledMessages} sending={schedulingMessage}
        onSchedule={async (data) => {
          if (!conversation?.id) return;
          setSchedulingMessage(true);
          try { await scheduleMessage(conversation.id, data); const updated = await getScheduledMessages(conversation.id); setScheduledMessages(updated); toast.success("Mensagem agendada!"); }
          catch { toast.error("Erro ao agendar mensagem"); } finally { setSchedulingMessage(false); }
        }}
        onCancelScheduled={async (id) => {
          try { await cancelScheduledMessage(id); setScheduledMessages(prev => prev.filter(m => m.id !== id)); toast.success("Agendamento cancelado"); }
          catch { toast.error("Erro ao cancelar agendamento"); }
        }}
      />

      {conversation && <StartFlowDialog open={showStartFlowDialog} onClose={() => setShowStartFlowDialog(false)} conversationId={conversation.id} connectionId={conversation.connection_id} onFlowStarted={() => {}} />}

      {conversation && (
        <SendContactDialog
          open={showSendContactDialog}
          onOpenChange={setShowSendContactDialog}
          connectionId={conversation.connection_id}
          onSend={async (contactName, contactPhone) => {
            const payload = JSON.stringify({ contactName, contactPhone });
            await onSendMessage(payload, 'contact');
            toast.success('Contato enviado!');
          }}
        />
      )}

       <TransferDialog open={showTransferDialog} onOpenChange={setShowTransferDialog} conversation={conversation} team={team} availableConnections={connections} onTransfer={onTransfer} />
       <SyncDialog 
         open={showSyncDialog} 
         onOpenChange={setShowSyncDialog} 
         onSync={async (days) => {
           if (onSyncHistory) {
             await onSyncHistory(days);
             setShowSyncDialog(false);
           }
         }} 
         syncing={syncingHistory} 
       />
      <DepartmentDialog open={showDepartmentDialog} onOpenChange={setShowDepartmentDialog} conversation={conversation} departments={departments} onSave={handleSaveDepartment} saving={savingDepartment} />
      {onDeleteConversation && <DeleteConversationDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog} onDelete={onDeleteConversation} />}
      
      {conversation && isMetaConnection && (
        <SendTemplateDialog
          open={showTemplateDialog}
          onOpenChange={setShowTemplateDialog}
          connectionId={conversation.connection_id}
          conversationId={conversation.id}
          contactPhone={conversation.contact_phone || ""}
          onTemplateSent={() => {
            // Reload messages after template sent
            if (conversation?.id) {
              onLoadMore();
            }
          }}
        />
      )}
      
      <CreateTagDialog open={showTagDialog} onOpenChange={setShowTagDialog} onCreateTag={onCreateTag} />
      <EditContactDialog open={showEditContactDialog} onOpenChange={setShowEditContactDialog} conversation={conversation} />
      <RequestSignatureDialog
        open={showSignatureDialog}
        onOpenChange={setShowSignatureDialog}
        contactName={conversation?.contact_name || undefined}
        contactPhone={conversation?.contact_phone || undefined}
      />
      </div>

      {/* Side Panels */}
      {showQuickReplies && (
        <QuickRepliesPanel onSelect={(content) => {
          const contactName = conversation?.contact_name || '';
          setMessageText(content.replace(/\{nome\}/gi, contactName));
        }} onClose={() => setShowQuickReplies(false)} />
      )}
      {showNotes && conversation && <NotesPanel conversationId={conversation.id} onClose={() => setShowNotes(false)} />}
      {showSummaryPanel && conversation && (
        <div className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-lg z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Resumo IA</h3>
            <Button variant="ghost" size="icon" onClick={() => setShowSummaryPanel(false)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="flex-1 overflow-hidden p-4"><ConversationSummaryPanel conversationId={conversation.id} contactPhone={conversation.contact_phone || undefined} className="h-full" /></div>
        </div>
      )}
      {conversation && <DealLinkDialog open={showDealDialog} onOpenChange={setShowDealDialog} contactName={conversation.contact_name} contactPhone={conversation.contact_phone} />}
      {conversation && (
        <CallLogDialog open={showCallDialog} onOpenChange={setShowCallDialog} contactName={conversation.contact_name} contactPhone={conversation.contact_phone} saving={savingCall}
          onLogCall={async (callData) => { setSavingCall(true); try { const result = await logCall(conversation.id, callData); if (result) { toast.success('Chamada registrada'); setShowCallDialog(false); } } finally { setSavingCall(false); } }}
        />
      )}
      <DealDetailDialog deal={selectedDeal} open={showDealDetailDialog} onOpenChange={open => { setShowDealDetailDialog(open); if (!open) setSelectedDeal(null); }} />
      {onForwardMessage && conversation && (
        <ForwardMessageDialog
          open={!!forwardingMessage}
          onOpenChange={(open) => { if (!open) setForwardingMessage(null); }}
          message={forwardingMessage}
          conversations={conversations}
          currentConversationId={conversation.id}
          onForward={onForwardMessage}
        />
      )}
    </div>
  );
}
