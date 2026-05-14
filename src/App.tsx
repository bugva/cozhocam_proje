import { useState, useEffect, useRef } from 'react';
import {
  PenTool, FileX, Menu, FolderOpen, Plus, ChevronRight,
  GraduationCap, Pencil, Check, Trash2, FolderPlus, FolderMinus, Settings, Share2, Download,
} from 'lucide-react';
import { PdfUploader } from './components/PdfUploader';
import { Workspace } from './components/Workspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsPanel } from './components/SettingsPanel';
import { db, courseDB, defaultFolders, type DocumentRecord, type Course, type CourseFolder } from './utils/db';
import { loadSettings, type AppSettings } from './utils/settings';
import { exportDocument, importDocument } from './utils/share';

// ── Small inline-edit component ──────────────────────────────────────────────
function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  if (!editing) {
    return (
      <span
        onDoubleClick={() => { setDraft(value); setEditing(true); }}
        title="Çift tıkla → yeniden adlandır"
        style={{ cursor: 'text', flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >{value}</span>
    );
  }
  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { onSave(draft.trim() || value); setEditing(false); }
        if (e.key === 'Escape') setEditing(false);
      }}
      onBlur={() => { onSave(draft.trim() || value); setEditing(false); }}
      style={{
        flexGrow: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 5, color: '#fff', fontSize: 12, padding: '1px 6px', fontFamily: 'inherit', outline: 'none',
      }}
    />
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [docs, setDocs]                 = useState<DocumentRecord[]>([]);
  const [courses, setCourses]           = useState<Course[]>([]);
  const [activeDocId, setActiveDocId]   = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);
  const [uploadCourseId, setUploadCourseId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadSettings());
  const importInputRef = useRef<HTMLInputElement>(null);

  // Course creation state
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const newCourseInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showNewCourse) setTimeout(() => newCourseInputRef.current?.focus(), 50); }, [showNewCourse]);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [allDocs, allCourses] = await Promise.all([db.getAllDocuments(), courseDB.getAll()]);
    setDocs(allDocs);
    setCourses(allCourses);
  };

  // ── Document operations ───────────────────────────────────────────────────
  const handleFileLoad = async (data: ArrayBuffer, name: string) => {
    const newDoc: DocumentRecord = {
      id: crypto.randomUUID(), name, pdfData: data,
      regions: [], croppedItems: [], excalidrawElements: [], strokes: {},
      mode: 'SELECT_QUESTIONS', createdAt: Date.now(),
      courseId: uploadCourseId ?? undefined,
      folderId: uploadFolderId ?? undefined,
    };
    await db.saveDocument(newDoc);
    await loadAll();
    setActiveDocId(newDoc.id);
    setUploadFolderId(null);
    setUploadCourseId(null);
  };

  const handleSaveDoc = async (updated: DocumentRecord) => {
    await db.saveDocument(updated);
    setDocs(prev => prev.map(d => d.id === updated.id ? updated : d));
  };

  const handleDeleteDoc = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await db.deleteDocument(id);
    if (activeDocId === id) setActiveDocId(null);
    await loadAll();
  };

  const handleExportDoc = (e: React.MouseEvent, doc: DocumentRecord) => {
    e.stopPropagation();
    exportDocument(doc);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const doc = await importDocument(file);
      await db.saveDocument(doc);
      await loadAll();
      setActiveDocId(doc.id);
    } catch (err: any) {
      alert(err?.message || 'İçe aktarma başarısız');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  // ── Course operations ─────────────────────────────────────────────────────
  const createCourse = async () => {
    const name = newCourseName.trim();
    if (!name) return;
    const course: Course = { id: crypto.randomUUID(), name, folders: defaultFolders(), createdAt: Date.now() };
    await courseDB.save(course);
    setNewCourseName('');
    setShowNewCourse(false);
    await loadAll();
    setExpanded(prev => new Set([...prev, course.id]));
  };

  const deleteCourse = async (e: React.MouseEvent, courseId: string) => {
    e.stopPropagation();
    if (!confirm('Bu dersi silmek istiyor musunuz? Derse ait belgeler etkilenmez.')) return;
    await courseDB.delete(courseId);
    await loadAll();
  };

  const updateCourse = async (courseId: string, patch: Partial<Course>) => {
    const course = courses.find(c => c.id === courseId);
    if (!course) return;
    const updated = { ...course, ...patch };
    await courseDB.save(updated);
    setCourses(prev => prev.map(c => c.id === courseId ? updated : c));
  };

  const addFolder = async (courseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const course = courses.find(c => c.id === courseId);
    if (!course) return;
    // Count existing "Midterm N" folders to determine next number
    const midtermCount = course.folders.filter(f => f.name.startsWith('Midterm')).length;
    const newName = `Midterm ${midtermCount + 1}`;
    const newFolder: CourseFolder = { id: crypto.randomUUID(), name: newName };
    await updateCourse(courseId, { folders: [...course.folders, newFolder] });
  };

  const removeLastFolder = async (courseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const course = courses.find(c => c.id === courseId);
    if (!course || course.folders.length <= 1) return;
    await updateCourse(courseId, { folders: course.folders.slice(0, -1) });
  };

  const renameFolder = async (courseId: string, folderId: string, newName: string) => {
    const course = courses.find(c => c.id === courseId);
    if (!course) return;
    await updateCourse(courseId, {
      folders: course.folders.map(f => f.id === folderId ? { ...f, name: newName } : f),
    });
  };

  const toggleExpand = (courseId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(courseId) ? next.delete(courseId) : next.add(courseId);
      return next;
    });
  };

  // Docs that belong to a folder
  const folderDocs = (courseId: string, folderId: string) =>
    docs.filter(d => d.courseId === courseId && d.folderId === folderId);

  // Docs not yet assigned to any course
  const freeDocs = docs.filter(d => !d.courseId);

  // ── Drag-and-drop: move a doc into a folder ──
  const moveDocToFolder = async (docId: string, courseId: string, folderId: string) => {
    const doc = docs.find(d => d.id === docId);
    if (!doc) return;
    const updated = { ...doc, courseId, folderId };
    await db.saveDocument(updated);
    setDocs(prev => prev.map(d => d.id === docId ? updated : d));
  };

  const activeDoc = docs.find(d => d.id === activeDocId);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* ── Left Sidebar ── */}
      <aside style={{
        width: sidebarOpen ? 272 : 0, minWidth: sidebarOpen ? 272 : 0, flexShrink: 0,
        overflow: 'hidden', transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1), min-width 0.3s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)',
        height: '100vh', position: 'relative', zIndex: 20,
      }}>
        <div style={{ minWidth: 272, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Header */}
          <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, var(--accent), var(--purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,122,255,0.3)' }}>
                <PenTool size={14} color="#fff" />
              </div>
              <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '-0.04em', background: 'linear-gradient(135deg, var(--accent), var(--purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                ÇözHocam
              </span>
            </div>
            <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(false)}><Menu size={15} /></button>
          </div>

          {/* Create Course button */}
          <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
            {showNewCourse ? (
              <div style={{ display: 'flex', gap: 5 }}>
                <input
                  ref={newCourseInputRef}
                  value={newCourseName}
                  onChange={e => setNewCourseName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createCourse(); if (e.key === 'Escape') setShowNewCourse(false); }}
                  placeholder="Ders adı..."
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 8, color: '#fff', fontSize: 13, padding: '6px 10px', fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <button onClick={createCourse} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center' }}>
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewCourse(true)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 12px', borderRadius: 10, border: '1.5px dashed rgba(0,122,255,0.35)',
                  background: 'rgba(0,122,255,0.06)', color: 'var(--accent)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,122,255,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,122,255,0.06)'; }}
              >
                <GraduationCap size={13} /> Ders Oluştur
              </button>
            )}
          </div>

          {/* Scrollable tree */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>

            {/* Course list */}
            {courses.map(course => {
              const isOpen = expanded.has(course.id);
              return (
                <div key={course.id} style={{ marginBottom: 4 }}>
                  {/* Course row */}
                  <div
                    onClick={() => toggleExpand(course.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 8px', borderRadius: 9, cursor: 'pointer',
                      background: isOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <ChevronRight size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }} />
                    <GraduationCap size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {course.name}
                    </span>
                    {/* Add/remove folder buttons */}
                    <button onClick={e => addFolder(course.id, e)} title="Alt klasör ekle" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 3, borderRadius: 5, display: 'flex', transition: 'color 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}>
                      <FolderPlus size={12} />
                    </button>
                    <button onClick={e => removeLastFolder(course.id, e)} title="Son klasörü sil" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 3, borderRadius: 5, display: 'flex', transition: 'color 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff453a'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}>
                      <FolderMinus size={12} />
                    </button>
                    <button onClick={e => deleteCourse(e, course.id)} title="Dersi sil" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 3, borderRadius: 5, display: 'flex', transition: 'color 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff453a'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}>
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {/* Folders (collapsed with CSS) */}
                  <div style={{
                    maxHeight: isOpen ? 2000 : 0, overflow: 'hidden',
                    transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
                  }}>
                    {course.folders.map(folder => {
                      const fDocs = folderDocs(course.id, folder.id);
                      return (
                        <div key={folder.id} style={{ marginLeft: 18, marginTop: 2 }}>
                          {/* Folder row — drop zone */}
                          <div
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '5px 8px', borderRadius: 8,
                              background: dragOverFolderId === folder.id ? 'rgba(0,122,255,0.15)' : 'transparent',
                              border: dragOverFolderId === folder.id ? '1.5px dashed rgba(0,122,255,0.5)' : '1.5px solid transparent',
                              transition: 'background 0.12s, border 0.12s',
                            }}
                            onDragOver={e => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                            onDragLeave={() => setDragOverFolderId(null)}
                            onDrop={e => {
                              e.preventDefault();
                              const docId = e.dataTransfer.getData('docId');
                              if (docId) moveDocToFolder(docId, course.id, folder.id);
                              setDragOverFolderId(null);
                            }}
                          >
                            <FolderOpen size={12} style={{ color: dragOverFolderId === folder.id ? 'var(--accent)' : '#ff9f0a', flexShrink: 0 }} />
                            <InlineEdit
                              value={folder.name}
                              onSave={name => renameFolder(course.id, folder.id, name)}
                            />
                            <button
                              onClick={() => { setUploadCourseId(course.id); setUploadFolderId(folder.id); }}
                              title="PDF Ekle"
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px',
                                borderRadius: 6, display: 'flex', alignItems: 'center', gap: 3,
                                color: 'var(--text-tertiary)', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
                                flexShrink: 0, transition: 'color 0.15s',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}
                            >
                              <Plus size={10} /> PDF
                            </button>
                          </div>

                          {/* Documents in this folder */}
                          {fDocs.map(d => {
                            const isActive = activeDocId === d.id;
                            return (
                              <div
                                key={d.id}
                                draggable
                                onDragStart={e => e.dataTransfer.setData('docId', d.id)}
                                onClick={() => setActiveDocId(d.id)}
                                style={{
                                  marginLeft: 16, padding: '5px 8px', borderRadius: 7,
                                  cursor: 'grab', display: 'flex', alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: isActive ? 'linear-gradient(135deg, var(--accent), rgba(0,122,255,0.85))' : 'transparent',
                                  color: isActive ? '#fff' : 'var(--text-secondary)',
                                  transition: 'all 0.15s', marginTop: 1,
                                }}
                                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-item-hover)'; }}
                                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <span style={{ fontSize: 11 }}>📄</span>
                                  <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {d.name.replace('.pdf', '')}
                                  </span>
                                </div>
                                <button onClick={ev => handleDeleteDoc(ev, d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--text-tertiary)', padding: 3, borderRadius: 4, display: 'flex', opacity: 0.7, transition: 'opacity 0.15s' }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}>
                                  <FileX size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Free docs (no course) */}
            {freeDocs.length > 0 && (
              <>
                <div style={{ padding: '10px 8px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Diğer Belgeler</div>
                {freeDocs.map(d => {
                  const isActive = activeDocId === d.id;
                  return (
                    <div key={d.id} style={{ marginBottom: 3 }}>
                      {/* Doc row */}
                      <div
                        draggable
                        onDragStart={e => e.dataTransfer.setData('docId', d.id)}
                        onClick={() => setActiveDocId(d.id)}
                        style={{
                          padding: '8px 10px', borderRadius: isActive ? '9px 9px 0 0' : 9, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: isActive ? 'linear-gradient(135deg, var(--accent), rgba(0,122,255,0.85))' : 'transparent',
                          color: isActive ? '#fff' : 'var(--text-primary)', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-item-hover)'; }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 13 }}>📄</span>
                          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name.replace('.pdf', '')}</span>
                        </div>
                        <button onClick={ev => handleDeleteDoc(ev, d.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: isActive ? 'rgba(255,255,255,0.5)' : 'var(--text-tertiary)', padding: 4, borderRadius: 5, display: 'flex', opacity: 0, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                          onFocus={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                          onBlur={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                        >
                          <FileX size={13} />
                        </button>
                      </div>

                      {/* Action bar — only when active */}
                      {isActive && (
                        <div style={{
                          display: 'flex', gap: 5, padding: '6px 8px',
                          background: 'rgba(0,122,255,0.12)',
                          borderRadius: '0 0 9px 9px',
                          borderTop: '1px solid rgba(255,255,255,0.1)',
                        }}>
                          <button
                            onClick={ev => handleExportDoc(ev, d)}
                            style={{
                              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                              padding: '5px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
                              background: 'rgba(255,255,255,0.12)', color: '#fff',
                              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.22)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; }}
                          >
                            <Share2 size={11} /> Dışa Aktar
                          </button>
                          <button
                            onClick={ev => handleDeleteDoc(ev, d.id)}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                              padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                              background: 'rgba(255,69,58,0.15)', color: '#ff453a',
                              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,69,58,0.28)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,69,58,0.15)'; }}
                          >
                            <Trash2 size={11} /> Sil
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {courses.length === 0 && freeDocs.length === 0 && (
              <div style={{ margin: '16px 4px', padding: '20px 16px', borderRadius: 12, border: '1.5px dashed var(--sidebar-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)' }}>
                <GraduationCap size={24} opacity={0.5} />
                <span style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.5 }}>Ders oluşturun veya doğrudan PDF yükleyin.</span>
              </div>
            )}
          </div>

          {/* Bottom: settings + import + upload */}
          <div style={{ padding: '10px 10px 14px', flexShrink: 0, borderTop: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowSettings(true)} style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 12px', borderRadius: 10, border: 'none',
                background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
              >
                <Settings size={13} /> Ayarlar
              </button>
              <button onClick={() => importInputRef.current?.click()} title=".coz dosyasını içe aktar" style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 10, border: 'none',
                background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(48,209,88,0.1)'; (e.currentTarget as HTMLElement).style.color = '#30d158'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              >
                <Download size={13} /> İçe Aktar
              </button>
            </div>
            <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImport} />
            <PdfUploader onFileLoad={handleFileLoad} compact />
          </div>
        </div>
      </aside>

      {/* ── Sidebar toggle bar ── */}
      <div onClick={() => setSidebarOpen(v => !v)} title={sidebarOpen ? 'Paneli kapat' : 'Paneli aç'} style={{
        flexShrink: 0, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', background: 'var(--sidebar-border)', position: 'relative', zIndex: 200, transition: 'background 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-border)'; }}
      >
        <div style={{ width: 4, height: 32, borderRadius: 4, background: 'currentColor', opacity: 0.4, color: 'var(--text-primary)' }} />
      </div>

      {/* ── Folder PDF Upload Modal ── */}
      {uploadFolderId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => { setUploadFolderId(null); setUploadCourseId(null); }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 16, padding: 28, minWidth: 340, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={e => e.stopPropagation()}>
            {(() => {
              const course = courses.find(c => c.id === uploadCourseId);
              const folder = course?.folders.find(f => f.id === uploadFolderId);
              return (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{course?.name}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{folder?.name} — PDF Ekle</div>
                  </div>
                  <PdfUploader onFileLoad={handleFileLoad} compact={false} />
                  <button onClick={() => { setUploadFolderId(null); setUploadCourseId(null); }} style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 13, fontFamily: 'inherit', width: '100%', textAlign: 'center' }}>İptal</button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        <ErrorBoundary>
          <main style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {!activeDoc ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, background: 'var(--bg-canvas)' }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg, rgba(0,122,255,0.12), rgba(191,90,242,0.12))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,122,255,0.15)' }}>
                  <PenTool size={30} color="var(--text-tertiary)" />
                </div>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Çalışmaya başlayın</p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Bir ders oluşturun veya sol panelden PDF seçin.</p>
                </div>
                <button className="btn btn-primary" onClick={() => setSidebarOpen(true)} style={{ gap: 7 }}>
                  <Pencil size={15} /> Başla
                </button>
              </div>
            ) : (
              <Workspace key={activeDoc.id} doc={activeDoc} onSave={handleSaveDoc} solveLayout={appSettings.solveLayout} />
            )}
          </main>
        </ErrorBoundary>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          settings={appSettings}
          onChange={s => setAppSettings(s)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
