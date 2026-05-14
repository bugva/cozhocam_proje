import localforage from 'localforage';
import type { Region } from '../components/PdfViewer';

export interface CourseFolder {
  id: string;
  name: string;
}

export interface Course {
  id: string;
  name: string;
  folders: CourseFolder[];
  createdAt: number;
}

export interface CroppedItem {
  regionId: string;
  type: 'question' | 'solution' | 'stem';
  dataUrl: string;
  width: number;
  height: number;
  questionIndex: number;  // sorular için: soru numarası; kökler için: benzersiz index
  sortY: number;          // PDF'deki y koordinatı — sıralama için
}

export interface DocumentRecord {
  id: string;
  name: string;
  pdfData: ArrayBuffer;
  regions: Region[];
  croppedItems: CroppedItem[];
  excalidrawElements: readonly any[];
  strokes: Record<number, any[]>;
  mode: 'SELECT_QUESTIONS' | 'ADJUST_SOLUTIONS' | 'SOLVE';
  createdAt: number;
  courseId?: string;   // hangi derse ait
  folderId?: string;   // hangi alt klasöre ait
}

const docStore = localforage.createInstance({ name: 'cozhocam', storeName: 'documents' });
const courseStore = localforage.createInstance({ name: 'cozhocam', storeName: 'courses' });

export const db = {
  async getAllDocuments(): Promise<DocumentRecord[]> {
    const docs: DocumentRecord[] = [];
    await docStore.iterate((value: DocumentRecord) => { docs.push(value); });
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  },
  async getDocument(id: string): Promise<DocumentRecord | null> {
    return docStore.getItem<DocumentRecord>(id);
  },
  async saveDocument(doc: DocumentRecord): Promise<void> {
    await docStore.setItem(doc.id, doc);
  },
  async deleteDocument(id: string): Promise<void> {
    await docStore.removeItem(id);
  },
};

export const courseDB = {
  async getAll(): Promise<Course[]> {
    const list: Course[] = [];
    await courseStore.iterate((v: Course) => { list.push(v); });
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  async save(course: Course): Promise<void> {
    await courseStore.setItem(course.id, course);
  },
  async delete(id: string): Promise<void> {
    await courseStore.removeItem(id);
  },
};

/** Default folders when creating a new course */
export function defaultFolders(): CourseFolder[] {
  return [
    { id: crypto.randomUUID(), name: 'Midterm 1' },
    { id: crypto.randomUUID(), name: 'Midterm 2' },
    { id: crypto.randomUUID(), name: 'Final' },
  ];
}
