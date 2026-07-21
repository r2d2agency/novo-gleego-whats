import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
// Bundle the pdf.js worker locally via Vite so PDF rendering doesn't depend on
// an external CDN (unpkg) — this was causing the viewer to fail to load PDFs.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Move, Save, Loader2, Plus, MousePointer, Trash2 } from 'lucide-react';
import { DocSigner, SignaturePosition } from '@/hooks/use-doc-signatures';
import { resolveMediaUrl } from '@/lib/media';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

interface DraggableBox {
  id: string;
  signer_id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  fileUrl: string;
  signers: DocSigner[];
  existingPositions: SignaturePosition[];
  onSave: (positions: DraggableBox[]) => Promise<void>;
  readOnly?: boolean;
  previewSignatureBySigner?: Record<string, string | null | undefined>;
  auditPreviewBySigner?: Record<string, {
    name?: string;
    cpf?: string;
    geolocation?: string;
    signedAt?: string;
  }>;
}

const SIGNER_COLORS = [
  'hsl(var(--primary))',
  'hsl(210, 80%, 55%)',
  'hsl(150, 60%, 45%)',
  'hsl(30, 90%, 55%)',
  'hsl(280, 60%, 55%)',
  'hsl(0, 70%, 55%)',
];

export function PdfSignaturePositioner({
  fileUrl,
  signers,
  existingPositions,
  onSave,
  readOnly = false,
  previewSignatureBySigner,
  auditPreviewBySigner,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [boxes, setBoxes] = useState<DraggableBox[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [selectedSigner, setSelectedSigner] = useState<string>('');
  const [addMode, setAddMode] = useState(false);
  const justDragged = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const toNumber = useCallback((value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }, []);

  useEffect(() => {
    setBoxes(existingPositions.map((p) => ({
      id: p.id,
      signer_id: p.signer_id,
      page: Math.max(1, Math.round(toNumber(p.page, 1))),
      x: toNumber(p.x, 0),
      y: toNumber(p.y, 0),
      width: Math.max(100, toNumber(p.width, 200)),
      height: Math.max(40, toNumber(p.height, 60)),
    })));
  }, [existingPositions, toNumber]);

  useEffect(() => {
    if (signers.length > 0 && !selectedSigner) {
      setSelectedSigner(signers[0].id);
    }
  }, [signers]);

  const getSignerColor = (signerId: string) => {
    const idx = signers.findIndex(s => s.id === signerId);
    return SIGNER_COLORS[idx % SIGNER_COLORS.length];
  };

  const getSignerName = (signerId: string) => {
    return signers.find(s => s.id === signerId)?.name || 'Desconhecido';
  };

  const handleDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPdfError(null);
  };

  const handleDocumentLoadError = useCallback((error: Error) => {
    const message = error?.message?.trim() || 'Falha ao ler o arquivo PDF.';
    setPdfError(message);
    console.error('[PdfSignaturePositioner] Erro ao carregar PDF:', {
      fileUrl,
      resolvedUrl: resolveMediaUrl(fileUrl),
      message,
    });
  }, [fileUrl]);

  const handlePageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || !addMode || !selectedSigner || dragging || resizing) return;
    if (justDragged.current) { justDragged.current = false; return; }

    const target = e.target;
    if (target instanceof Element && target.closest('[data-signature-box="true"]')) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    // Check if click is on existing box
    const clickedBox = boxes.find(b =>
      b.page === currentPage &&
      x >= b.x && x <= b.x + b.width &&
      y >= b.y && y <= b.y + b.height
    );
    if (clickedBox) return;

    const newBox: DraggableBox = {
      id: crypto.randomUUID(),
      signer_id: selectedSigner,
      page: currentPage,
      x: Math.max(0, x - 100),
      y: Math.max(0, y - 30),
      width: 200,
      height: 60,
    };
    setBoxes(prev => [...prev, newBox]);
  }, [readOnly, addMode, selectedSigner, currentPage, scale, dragging, resizing, boxes]);

  const getPointerPosition = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, [scale]);

  const handleMouseDown = (e: React.MouseEvent, boxId: string, isResize = false) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();

    const box = boxes.find(b => b.id === boxId);
    if (!box) return;

    const pointer = getPointerPosition(e.clientX, e.clientY);
    if (!pointer) return;

    if (isResize) {
      setResizing(boxId);
    } else {
      setDragging(boxId);
      setDragOffset({
        x: pointer.x - box.x,
        y: pointer.y - box.y,
      });
    }
  };

  const updateDraggingPosition = useCallback((clientX: number, clientY: number) => {
    if (!dragging && !resizing) return;

    const pointer = getPointerPosition(clientX, clientY);
    if (!pointer) return;

    setBoxes(prev => prev.map(b => {
      if (dragging && b.id === dragging) {
        return { ...b, x: Math.max(0, pointer.x - dragOffset.x), y: Math.max(0, pointer.y - dragOffset.y) };
      }
      if (resizing && b.id === resizing) {
        return {
          ...b,
          width: Math.max(100, pointer.x - b.x),
          height: Math.max(40, pointer.y - b.y),
        };
      }
      return b;
    }));
  }, [dragging, resizing, dragOffset, getPointerPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    updateDraggingPosition(e.clientX, e.clientY);
  }, [updateDraggingPosition]);

  const handleMouseUp = useCallback(() => {
    if (dragging || resizing) {
      justDragged.current = true;
    }
    setDragging(null);
    setResizing(null);
  }, [dragging, resizing]);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      updateDraggingPosition(e.clientX, e.clientY);
    };

    const handleWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragging, resizing, updateDraggingPosition, handleMouseUp]);

  const removeBox = (boxId: string) => {
    setBoxes(prev => prev.filter(b => b.id !== boxId));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalizedBoxes = boxes.map((box) => ({
        ...box,
        page: Math.max(1, Math.round(toNumber(box.page, 1))),
        x: toNumber(box.x, 0),
        y: toNumber(box.y, 0),
        width: Math.max(100, toNumber(box.width, 200)),
        height: Math.max(40, toNumber(box.height, 60)),
      }));
      await onSave(normalizedBoxes);
    } finally {
      setSaving(false);
    }
  };

  const resolvedUrl = resolveMediaUrl(fileUrl);

  useEffect(() => {
    setPdfError(null);
  }, [resolvedUrl]);

  const currentPageBoxes = boxes.filter(b => b.page === currentPage);
  const previewSignatures = previewSignatureBySigner ?? {};
  const previewAudit = auditPreviewBySigner ?? {};

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-muted rounded-lg">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[80px] text-center">
            Página {currentPage} / {numPages || '?'}
          </span>
          <Button variant="outline" size="icon" disabled={currentPage >= numPages} onClick={() => setCurrentPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setScale(s => Math.max(0.5, s - 0.1))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="outline" size="icon" onClick={() => setScale(s => Math.min(2, s + 0.1))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={addMode ? 'default' : 'outline'}
              onClick={() => setAddMode(m => !m)}
              className="gap-1"
            >
              {addMode ? <Plus className="h-3 w-3" /> : <MousePointer className="h-3 w-3" />}
              {addMode ? 'Adicionando...' : 'Adicionar Área'}
            </Button>
            <Select value={selectedSigner} onValueChange={setSelectedSigner}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="Selecione signatário" />
              </SelectTrigger>
              <SelectContent>
                {signers.map((s, i) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {boxes.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBoxes([])} className="gap-1 text-destructive hover:text-destructive">
                <Trash2 className="h-3 w-3" />
                Limpar Todas
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar Posições
            </Button>
          </div>
        )}
      </div>

      {/* Legend */}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {signers.map((s, i) => (
            <Badge key={s.id} variant="outline" className="text-xs gap-1" style={{ borderColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }} />
              {s.name} ({boxes.filter(b => b.signer_id === s.id).length} áreas)
            </Badge>
          ))}
          {!readOnly && <p className="text-xs text-muted-foreground ml-2 self-center">{addMode ? 'Clique no PDF para adicionar área de assinatura' : 'Arraste as caixas para reposicionar. Use "Adicionar Área" para criar novas.'}</p>}
        </div>
      )}

      {/* PDF Viewer with overlay */}
      <div
        ref={containerRef}
        className="border rounded-lg overflow-auto bg-muted/30 max-h-[600px]"
      >
        <div className="inline-block relative">
          <Document
            file={resolvedUrl}
            onLoadSuccess={handleDocumentLoadSuccess}
            onLoadError={handleDocumentLoadError}
            onSourceError={handleDocumentLoadError}
            loading={<div className="flex items-center justify-center p-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}
            error={
              <div className="p-10 text-center text-destructive space-y-1">
                <p>Erro ao carregar PDF. Verifique o arquivo.</p>
                {pdfError && <p className="text-xs text-muted-foreground">{pdfError}</p>}
              </div>
            }
          >
            <div
              ref={surfaceRef}
              className="relative"
              onClick={handlePageClick}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: readOnly ? 'default' : (dragging || resizing ? 'grabbing' : (addMode ? 'crosshair' : 'default')) }}
            >
              <Page pageNumber={currentPage} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />

              {/* Signature boxes overlay */}
              {currentPageBoxes.map((box) => {
                const signerColor = getSignerColor(box.signer_id);
                const previewSignatureUrl = previewSignatures[box.signer_id];
                const auditPreview = previewAudit[box.signer_id];

                return (
                  <div
                    key={box.id}
                    data-signature-box="true"
                    className="absolute border-2 rounded flex flex-col items-center justify-center text-xs select-none group overflow-hidden"
                    style={{
                      left: box.x * scale,
                      top: box.y * scale,
                      width: box.width * scale,
                      height: box.height * scale,
                      borderColor: signerColor,
                      backgroundColor: `${signerColor}15`,
                      cursor: readOnly ? 'default' : 'move',
                      zIndex: 10,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, box.id)}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                  >
                    {previewSignatureUrl ? (
                      <img
                        src={previewSignatureUrl}
                        alt={`Prévia da assinatura de ${getSignerName(box.signer_id)}`}
                        className="absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] object-contain pointer-events-none"
                        draggable={false}
                        loading="lazy"
                      />
                    ) : (
                      <>
                        <Move className="h-3 w-3 mb-0.5 opacity-50" />
                        <span className="font-medium truncate max-w-full px-1" style={{ color: signerColor }}>
                          {getSignerName(box.signer_id)}
                        </span>
                        <span className="text-[10px] opacity-60">Assinatura</span>
                      </>
                    )}

                    {readOnly && auditPreview && (
                      <div className="absolute inset-x-0 bottom-0 border-t bg-background/90 px-1 py-0.5 text-[9px] leading-tight text-foreground">
                        {auditPreview.cpf && <p className="truncate">CPF: {auditPreview.cpf}</p>}
                        {auditPreview.signedAt && <p className="truncate">Data/Hora: {new Date(auditPreview.signedAt).toLocaleString('pt-BR')}</p>}
                        {auditPreview.geolocation && <p className="truncate">Geo: {auditPreview.geolocation}</p>}
                      </div>
                    )}

                    {!readOnly && (
                      <>
                        <button
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          onClick={(e) => { e.stopPropagation(); removeBox(box.id); }}
                        >
                          ×
                        </button>
                        <div
                          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 group-hover:opacity-100"
                          style={{ borderRight: `2px solid ${signerColor}`, borderBottom: `2px solid ${signerColor}` }}
                          onMouseDown={(e) => handleMouseDown(e, box.id, true)}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Document>
        </div>
      </div>
    </div>
  );
}
