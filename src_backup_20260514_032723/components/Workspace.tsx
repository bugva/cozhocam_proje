import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.js?url';
import { PdfViewer, type Region } from './PdfViewer';
import { cropRegionFromPdf, buildPageLayouts, type PageLayout } from '../utils/pdfCrop';
import { SolveView } from './SolveView';
import { Settings, Check, Loader2 } from 'lucide-react';
import { type DocumentRecord, type CroppedItem } from '../utils/db';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface WorkspaceProps {
  doc: DocumentRecord;
  onSave: (updated: DocumentRecord) => void;
}

export const Workspace: React.FC<WorkspaceProps> = ({ doc, onSave }) => {
  const [mode, setMode] = useState(doc.mode);
  const [regions, setRegions] = useState<Region[]>(doc.regions);
  const [croppedItems, setCroppedItems] = useState<CroppedItem[]>(doc.croppedItems);
  const [isCropping, setIsCropping] = useState(false);
  const [cropProgress, setCropProgress] = useState({ current: 0, total: 0 });
  const [strokes, setStrokes] = useState<Record<number, any[]>>(doc.strokes || {});

  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pagesRef = useRef<PageLayout[]>([]);

  // Sync to db whenever key state changes
  useEffect(() => {
    onSave({ ...doc, mode, regions, croppedItems, strokes });
  }, [mode, regions, croppedItems, strokes]);

  // Load PDF for cropping
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(doc.pdfData.slice(0)),
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
      }).promise;
      if (cancelled) return;
      pdfRef.current = pdf;
      pagesRef.current = await buildPageLayouts(pdf);
    })();
    return () => { cancelled = true; };
  }, [doc.pdfData]);

  const inferSolutions = () => {
    const qs = regions.filter(r => r.type === 'question').sort((a, b) => a.y - b.y);
    if (!qs.length) return;
    const sols: Region[] = qs.map((q, i) => {
      const y0 = q.y + q.h;
      const y1 = i < qs.length - 1 ? qs[i + 1].y : y0 + 600;
      return { id: `sol-${i}`, x: 0, y: y0, w: 9999, h: Math.max(y1 - y0, 20), type: 'solution' };
    });
    setRegions([...qs, ...sols]);
    setMode('ADJUST_SOLUTIONS');
  };

  const startSolving = useCallback(async () => {
    if (!pdfRef.current || !pagesRef.current.length) return;
    setIsCropping(true);
    const allRegs = [...regions];
    setCropProgress({ current: 0, total: allRegs.length });

    try {
      const pdf = pdfRef.current;
      const pages = pagesRef.current;
      const items: CroppedItem[] = [];
      const questions = allRegs.filter(r => r.type === 'question').sort((a, b) => a.y - b.y);

      const stems = allRegs.filter(r => r.type === 'stem').sort((a, b) => a.y - b.y);

      for (let i = 0; i < allRegs.length; i++) {
        setCropProgress({ current: i + 1, total: allRegs.length });
        await new Promise(r => setTimeout(r, 0));
        const reg = allRegs[i];
        const dataUrl = await cropRegionFromPdf(pdf, pages, {
          x: reg.x, y: reg.y, w: reg.w, h: reg.h,
        });
        const dims = await imgDims(dataUrl);
        let qIdx = 0;
        if (reg.type === 'question') {
          qIdx = questions.indexOf(reg);
        } else if (reg.type === 'stem') {
          // Her öncül bağımsız: kendi benzersiz indeksi = questions.length + stemIndex
          qIdx = questions.length + stems.indexOf(reg);
        } else {
          // solution: ID'deki indeks veya 0
          const m = reg.id.match(/sol-(\d+)/);
          qIdx = m ? parseInt(m[1], 10) : 0;
        }
        items.push({
          regionId: reg.id,
          type: reg.type as 'question' | 'solution' | 'stem',
          dataUrl, width: dims.width, height: dims.height,
          questionIndex: qIdx,
          sortY: reg.y,  // PDF'deki konum — SolveView sıralaması için
        });
      }

      setCroppedItems(items);
      setMode('SOLVE');
    } catch (err) { console.error('Crop error:', err); }
    finally { setIsCropping(false); }
  }, [regions]);

  const handleStrokesChange = useCallback((questionIndex: number, newStrokes: any[]) => {
    setStrokes(prev => ({ ...prev, [questionIndex]: newStrokes }));
  }, []);

  // "Düzenle" — sorulara veya çözüm alanlarına dönmek için, çizimler silinmez
  const goEdit = () => {
    if (mode === 'ADJUST_SOLUTIONS') setMode('SELECT_QUESTIONS');
    else if (mode === 'SOLVE') setMode('SELECT_QUESTIONS'); // strokes korunur, sadece mod değişir
  };

  const questions = croppedItems.filter(c => c.type === 'question');
  const solutions = croppedItems.filter(c => c.type === 'solution');
  const stems    = croppedItems.filter(c => c.type === 'stem');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div className="workspace-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {mode !== 'SELECT_QUESTIONS' && (
            <button className="btn btn-ghost" onClick={goEdit}>
              <Settings size={14} /> Düzenle
            </button>
          )}
          <span className={`step-badge ${mode === 'ADJUST_SOLUTIONS' ? 'step-2' : mode === 'SOLVE' ? 'step-3' : ''}`}>
            {mode === 'SELECT_QUESTIONS' && '① Soruları işaretle'}
            {mode === 'ADJUST_SOLUTIONS' && '② Çözüm alanlarını onayla'}
            {mode === 'SOLVE' && '③ Çöz!'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mode === 'SELECT_QUESTIONS' && (
            <button className="btn btn-primary" onClick={inferSolutions}
              disabled={!regions.some(r => r.type === 'question')}>
              <Settings size={14} /> Alanları Çıkar
            </button>
          )}
          {mode === 'ADJUST_SOLUTIONS' && (
            <button className="btn btn-success" onClick={startSolving} disabled={isCropping}>
              {isCropping ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {isCropping ? 'Kırpılıyor…' : 'Çözüme Başla'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Loading overlay */}
        {isCropping && (
          <div className="loading-overlay">
            <div className="loading-card">
              <Loader2 size={36} color="var(--accent)" className="spin" />
              <span style={{ fontWeight: 700, fontSize: 16 }}>Sorular kırpılıyor…</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {cropProgress.current} / {cropProgress.total} alan
              </span>
              <div className="progress-bar-track">
                <div className="progress-bar-fill"
                  style={{ width: `${cropProgress.total ? (cropProgress.current / cropProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Phase 1 & 2 — PDF selection */}
        {mode !== 'SOLVE' && (
          <div style={{
            width: '100%', height: '100%', overflow: 'auto',
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            background: 'var(--bg-canvas)', padding: 32,
          }}>
            <PdfViewer pdfData={doc.pdfData} mode={mode} regions={regions}
              onRegionsChange={setRegions} showOriginal={false} />
          </div>
        )}

        {/* Phase 3 — A4 Solve View */}
        {mode === 'SOLVE' && (
          <SolveView
            questions={questions}
            stems={stems}
            solutions={solutions}
            allStrokes={strokes}
            onStrokesChange={handleStrokesChange}
          />
        )}
      </div>
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function imgDims(url: string): Promise<{ width: number; height: number }> {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res({ width: img.width, height: img.height });
    img.onerror = () => res({ width: 200, height: 200 });
    img.src = url;
  });
}
