import React, { useRef, useState } from 'react';
import { Upload, FileText, Plus } from 'lucide-react';

interface PdfUploaderProps {
  onFileLoad: (data: ArrayBuffer, fileName: string) => void;
  compact?: boolean;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({ onFileLoad, compact }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type === 'application/pdf') {
      const buffer = await file.arrayBuffer();
      onFileLoad(buffer, file.name);
    }
  };

  if (compact) {
    return (
      <button
        className="sidebar-upload-btn"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <Plus size={15} />
        Yeni PDF Yükle
        <input type="file" accept="application/pdf" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} style={{ display: 'none' }} />
      </button>
    );
  }

  return (
    <div className="upload-screen">
      <div
        className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="upload-icon-wrap">
          {isDragging ? <FileText size={32} color="#fff" /> : <Upload size={32} color="#fff" />}
        </div>
        <span className="upload-title">
          {isDragging ? 'Bırak ve yükle!' : 'Çıkmış sınav PDF yükle'}
        </span>
        <span className="upload-subtitle">
          Sürükle & bırak veya tıklayarak seç
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
    </div>
  );
};
