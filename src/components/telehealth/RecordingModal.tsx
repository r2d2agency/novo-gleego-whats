import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AudioWaveform } from '@/components/chat/AudioWaveform';
import { Mic, Square, Pause, Play, Upload, X, FileText, Image, AlertTriangle, Loader2, Monitor, MicOff, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpload } from '@/hooks/use-upload';
import { useTelehealth } from '@/hooks/use-telehealth';
import { toast } from 'sonner';

type AudioSource = 'mic' | 'screen' | 'both';

interface RecordingModalProps {
  open: boolean;
  onClose: () => void;
  // Legacy fallback: sessionless mode still returns a Blob. New chunked mode uses `sessionId` and calls `onFinished()` when done.
  onFinish?: (audioBlob: Blob, reason: string, notes: string, duration: number, attachments: Array<{ name: string; url: string; type: string }>) => void;
  onFinished?: (args: { reason: string; notes: string; duration: number; attachments: Array<{ name: string; url: string; type: string }> }) => void;
  sessionId?: string;
  sessionTitle?: string;
}

export function RecordingModal({ open, onClose, onFinish, onFinished, sessionId, sessionTitle }: RecordingModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(20).fill(0));
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string; type: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>('mic');
  const [screenShareActive, setScreenShareActive] = useState(false);
  // Chunked upload state
  const [chunkQueue, setChunkQueue] = useState<{ total: number; uploaded: number; failed: number }>({ total: 0, uploaded: 0, failed: 0 });
  const [isFinalizing, setIsFinalizing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useUpload();
  const { uploadChunk, finalizeChunkedUpload } = useTelehealth();

  // Chunked upload queue refs — decouples recording (fast) from network (slow/unreliable)
  const chunkIndexRef = useRef(0);
  const chunkQueueRef = useRef<Array<{ index: number; blob: Blob }>>([]);
  const uploaderBusyRef = useRef(false);
  const uploadAbortRef = useRef(false);
  const uploadedCountRef = useRef(0);

  const processUploadQueue = useCallback(async () => {
    if (!sessionId) return;
    if (uploaderBusyRef.current) return;
    uploaderBusyRef.current = true;
    try {
      while (chunkQueueRef.current.length > 0 && !uploadAbortRef.current) {
        const item = chunkQueueRef.current[0];
        const ok = await uploadChunk(sessionId, item.blob, item.index);
        if (ok) {
          chunkQueueRef.current.shift();
          uploadedCountRef.current += 1;
          setChunkQueue(q => ({ ...q, uploaded: uploadedCountRef.current }));
        } else {
          setChunkQueue(q => ({ ...q, failed: q.failed + 1 }));
          // Wait a bit and try again — keeps recording resilient on flaky network
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    } finally {
      uploaderBusyRef.current = false;
    }
  }, [sessionId, uploadChunk]);

  const updateLevels = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const bands = 20;
    const bandSize = Math.floor(dataArray.length / bands);
    const levels: number[] = [];
    for (let i = 0; i < bands; i++) {
      let sum = 0;
      for (let j = 0; j < bandSize; j++) sum += dataArray[i * bandSize + j];
      levels.push(sum / (bandSize * 255));
    }
    setAudioLevels(levels);
    animFrameRef.current = requestAnimationFrame(updateLevels);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      chunkIndexRef.current = 0;
      chunkQueueRef.current = [];
      uploadAbortRef.current = false;
      uploadedCountRef.current = 0;
      setChunkQueue({ total: 0, uploaded: 0, failed: 0 });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const destination = ctx.createMediaStreamDestination();
      let micStream: MediaStream | null = null;
      let screenStream: MediaStream | null = null;

      // Get mic audio (for 'mic' or 'both' modes)
      if (audioSource === 'mic' || audioSource === 'both') {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
        });
        streamRef.current = micStream;
        const micSource = ctx.createMediaStreamSource(micStream);
        micSource.connect(analyser);
        micSource.connect(destination);
      }

      // Get screen/system audio (for 'screen' or 'both' modes)
      if (audioSource === 'screen' || audioSource === 'both') {
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true, // video is required by some browsers to enable audio
          });
          screenStreamRef.current = screenStream;
          setScreenShareActive(true);

          // Check if we actually got audio tracks
          const audioTracks = screenStream.getAudioTracks();
          if (audioTracks.length === 0) {
            toast.warning('Nenhum áudio do sistema detectado. Certifique-se de marcar "Compartilhar áudio" na janela de compartilhamento.');
            if (audioSource === 'screen') {
              // No fallback - cleanup and return
              screenStream.getTracks().forEach(t => t.stop());
              if (micStream) micStream.getTracks().forEach(t => t.stop());
              ctx.close();
              setScreenShareActive(false);
              return;
            }
          } else {
            // Create audio-only stream from screen share
            const screenAudioStream = new MediaStream(audioTracks);
            const screenSource = ctx.createMediaStreamSource(screenAudioStream);
            screenSource.connect(analyser);
            screenSource.connect(destination);
          }

          // Listen for screen share stop (user clicks "Stop sharing")
          screenStream.getVideoTracks().forEach(track => {
            track.onended = () => {
              setScreenShareActive(false);
              toast.info('Compartilhamento de tela encerrado');
              // If recording only screen, stop recording
              if (audioSource === 'screen' && mediaRecorderRef.current?.state === 'recording') {
                // Auto-finish
                finishRecordingRef.current?.();
              }
            };
          });
        } catch (screenErr: any) {
          if (screenErr.name === 'NotAllowedError') {
            toast.error('Compartilhamento de tela cancelado pelo usuário');
          } else {
            toast.error('Erro ao capturar áudio do sistema: ' + (screenErr.message || ''));
          }
          // Cleanup mic if we already got it
          if (micStream) micStream.getTracks().forEach(t => t.stop());
          ctx.close();
          return;
        }
      }

      // If only mic (no screen), connect mic to analyser directly
      if (audioSource === 'mic' && micStream) {
        // Already connected above
      }

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      // Use the mixed destination stream for recording
      const recordingStream = destination.stream;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/wav';

      chunksRef.current = [];
      const recorder = new MediaRecorder(recordingStream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = e => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Queue chunk for progressive upload (only when we have a sessionId)
          if (sessionId) {
            const idx = chunkIndexRef.current++;
            chunkQueueRef.current.push({ index: idx, blob: e.data });
            setChunkQueue(q => ({ ...q, total: idx + 1 }));
            processUploadQueue();
          }
        }
      };
      // 15s timeslice — each chunk is a self-contained upload unit that can retry
      // independently. Long meetings no longer buffer the whole file in memory.
      recorder.start(sessionId ? 15000 : 100);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);

      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      animFrameRef.current = requestAnimationFrame(updateLevels);
    } catch (e: any) {
      toast.error('Erro ao iniciar gravação: ' + (e.message || ''));
    }
  }, [updateLevels, audioSource, sessionId, processUploadQueue]);

  // Ref to allow screen share end handler to call finish
  const finishRecordingRef = useRef<(() => void) | null>(null);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach(t => t.stop()); screenStreamRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; analyserRef.current = null; }
    setScreenShareActive(false);
  }, []);

  const finishRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    const finalDuration = duration;
    recorder.onstop = async () => {
      const mime = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mime });
      cleanup();
      setIsRecording(false);
      setIsPaused(false);

      // Chunked path: wait for queue to drain, then finalize on the backend.
      if (sessionId && onFinished) {
        setIsFinalizing(true);
        try {
          // Kick uploader in case it's idle, then poll until queue empties.
          processUploadQueue();
          const deadline = Date.now() + 5 * 60 * 1000;
          while (chunkQueueRef.current.length > 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 500));
          }
          if (chunkQueueRef.current.length > 0) {
            toast.error('Alguns pedaços falharam. Tente novamente com melhor conexão.');
            setIsFinalizing(false);
            return;
          }
          const result = await finalizeChunkedUpload(sessionId, {
            reason,
            notes,
            duration: finalDuration,
            mime,
            totalChunks: chunkIndexRef.current,
          });
          setIsFinalizing(false);
          if (result) {
            if (attachments.length > 0 || reason || notes) {
              onFinished({ reason, notes, duration: finalDuration, attachments });
            } else {
              onFinished({ reason, notes, duration: finalDuration, attachments });
            }
          }
        } catch (err) {
          setIsFinalizing(false);
          toast.error('Erro ao finalizar upload');
        }
        return;
      }

      // Legacy single-blob path
      if (onFinish) onFinish(blob, reason, notes, finalDuration, attachments);
    };
    recorder.stop();
  }, [duration, reason, notes, attachments, cleanup, onFinish, onFinished, sessionId, processUploadQueue, finalizeChunkedUpload]);

  // Keep ref in sync
  useEffect(() => {
    finishRecordingRef.current = finishRecording;
  }, [finishRecording]);

  const cancelRecording = useCallback(() => {
    uploadAbortRef.current = true;
    chunkQueueRef.current = [];
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
    cleanup();
    setIsRecording(false);
    setIsPaused(false);
    setDuration(0);
    chunksRef.current = [];
    onClose();
  }, [cleanup, onClose]);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleFilesDrop = useCallback(async (files: FileList | File[]) => {
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const url = await uploadFile(file);
        if (url) {
          setAttachments(prev => [...prev, { name: file.name, url, type: file.type }]);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const sourceLabels: Record<AudioSource, { label: string; icon: any; desc: string }> = {
    mic: { label: 'Microfone', icon: Mic, desc: 'Grava apenas o áudio do seu microfone' },
    screen: { label: 'Áudio do Sistema', icon: Monitor, desc: 'Captura o áudio do sistema (Zoom, Meet, etc.)' },
    both: { label: 'Mic + Sistema', icon: Monitor, desc: 'Mixa microfone + áudio do sistema' },
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 gap-0" onInteractOutside={e => e.preventDefault()}>
        <div className="sr-only">
          <h2>Gravação de Teleatendimento</h2>
        </div>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">Gravação - {sessionTitle || 'Nova Sessão'}</h2>
            <p className="text-sm text-muted-foreground">Teleatendimento</p>
          </div>
          <Button variant="ghost" size="icon" onClick={cancelRecording}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Audio source selector - only before recording starts */}
          {!isRecording && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Fonte de Áudio</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(Object.keys(sourceLabels) as AudioSource[]).map(key => {
                  const item = sourceLabels[key];
                  const Icon = item.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setAudioSource(key)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center",
                        audioSource === key
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active source badge during recording */}
          {isRecording && (
            <div className="flex items-center justify-center gap-2">
              <Badge variant="outline" className="gap-1.5">
                {audioSource === 'mic' && <><Mic className="h-3 w-3" /> Microfone</>}
                {audioSource === 'screen' && <><Monitor className="h-3 w-3" /> Áudio do Sistema</>}
                {audioSource === 'both' && <><Monitor className="h-3 w-3" /> Mic + Sistema</>}
              </Badge>
              {screenShareActive && (
                <Badge className="bg-green-500 text-white gap-1">
                  <Monitor className="h-3 w-3" /> Compartilhando
                </Badge>
              )}
            </div>
          )}

          {/* Chunked upload progress — shows during and after recording */}
          {sessionId && (isRecording || isFinalizing) && chunkQueue.total > 0 && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-3 w-3" />
              <span>
                Enviando pedaços: {chunkQueue.uploaded}/{chunkQueue.total}
                {chunkQueue.failed > 0 && ` · ${chunkQueue.failed} retries`}
              </span>
            </div>
          )}
          {isFinalizing && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Finalizando envio…
            </div>
          )}

          {/* Timer + Waveform */}
          <div className="flex flex-col items-center space-y-4">
            <div className={cn(
              "text-5xl font-mono font-bold tabular-nums",
              isRecording && !isPaused ? "text-destructive animate-pulse" : "text-foreground"
            )}>
              {formatTime(duration)}
            </div>

            {isRecording && (
              <div className="w-full max-w-md">
                <AudioWaveform levels={audioLevels} className="justify-center" />
              </div>
            )}

            <div className="flex items-center gap-4">
              {!isRecording ? (
                <Button size="lg" onClick={startRecording} className="gap-2">
                  {audioSource === 'mic' ? <Mic className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
                  {audioSource === 'screen' ? 'Compartilhar e Gravar' : 'Iniciar Gravação'}
                </Button>
              ) : (
                <>
                  {isPaused ? (
                    <Button size="lg" variant="outline" onClick={resumeRecording} className="gap-2">
                      <Play className="h-5 w-5" /> Retomar
                    </Button>
                  ) : (
                    <Button size="lg" variant="outline" onClick={pauseRecording} className="gap-2">
                      <Pause className="h-5 w-5" /> Pausar
                    </Button>
                  )}
                  <Button size="lg" variant="destructive" onClick={finishRecording} className="gap-2">
                    <Square className="h-5 w-5" /> Finalizar
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Screen share info */}
          {!isRecording && (audioSource === 'screen' || audioSource === 'both') && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <Monitor className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="text-sm text-blue-700 dark:text-blue-400">
                  <p className="font-medium">Como funciona no Computador:</p>
                  <ol className="list-decimal ml-4 mt-1 space-y-1">
                    <li>Clique em "Compartilhar e Gravar"</li>
                    <li>Selecione a aba ou janela do Zoom/Meet/WhatsApp</li>
                    <li><strong>Marque "Compartilhar áudio"</strong> na janela de seleção</li>
                  </ol>
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                <Smartphone className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
                <div className="text-sm text-indigo-700 dark:text-indigo-400">
                  <p className="font-medium">Como gravar ligação no Celular:</p>
                  <p className="mt-1">
                    Para gravar uma ligação do <strong>WhatsApp ou Telefone</strong> no celular:
                  </p>
                  <ol className="list-decimal ml-4 mt-1 space-y-1">
                    <li>Ative o <strong>Viva-voz</strong> durante a ligação</li>
                    <li>Volte aqui e selecione <strong>"Microfone"</strong> como fonte</li>
                    <li>Inicie a gravação normalmente</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Motivo da Reunião</label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex: Consulta de retorno, Alinhamento de projeto..." />
            </div>
            <div>
              <label className="text-sm font-medium">Anotações Livres</label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anotações durante a reunião..." rows={4} />
            </div>
          </div>

          {/* Attachments */}
          <div>
            <label className="text-sm font-medium mb-2 block">Documentos Anexos</label>
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
                isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              )}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFilesDrop(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Arraste e solte PDFs ou imagens aqui, ou clique para selecionar
              </p>
              <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={e => e.target.files && handleFilesDrop(e.target.files)} />
            </div>
            {isUploading && <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</div>}
            {attachments.length > 0 && (
              <div className="mt-3 space-y-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                    {att.type.startsWith('image/') ? <Image className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    <span className="text-sm flex-1 truncate">{att.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Áudio armazenado por no máximo 24h e excluído automaticamente após processamento.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
