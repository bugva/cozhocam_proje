import { type DocumentRecord } from './db';

const COZ_VERSION = 1;

interface CozFile {
  version: number;
  exportedAt: number;
  doc: Omit<DocumentRecord, 'pdfData'> & { pdfDataB64: string };
}

/** ArrayBuffer → base64 string */
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** base64 string → ArrayBuffer */
function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** DocumentRecord'u .cozhocam.json dosyası olarak indirir */
export function exportDocument(doc: DocumentRecord): void {
  const { pdfData, ...rest } = doc;
  const payload: CozFile = {
    version: COZ_VERSION,
    exportedAt: Date.now(),
    doc: { ...rest, pdfDataB64: bufToB64(pdfData) },
  };

  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ ]/g, '').trim() || 'calisma'}.cozhocam.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** .cozhocam.json dosyasını okuyup DocumentRecord olarak döndürür (yeni id ile) */
export function importDocument(file: File): Promise<DocumentRecord> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const payload: CozFile = JSON.parse(text);

        if (!payload.version || !payload.doc?.pdfDataB64) {
          throw new Error('Geçersiz ÇözHocam dosyası');
        }

        const { pdfDataB64, ...rest } = payload.doc;
        const doc: DocumentRecord = {
          ...rest,
          id: `imported-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          pdfData: b64ToBuf(pdfDataB64),
          createdAt: Date.now(),
        };
        resolve(doc);
      } catch (err: any) {
        reject(new Error('Dosya okunamadı: ' + (err?.message || err)));
      }
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.readAsText(file);
  });
}
