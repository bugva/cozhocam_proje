import React from 'react';
import { X, FileText, Layout } from 'lucide-react';
import { type SolveLayout, type AppSettings, saveSettings } from '../utils/settings';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onClose: () => void;
}

const layouts: { id: SolveLayout; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'classic', label: 'Klasik (A4 Kart)', desc: 'Sorular dikey kartlar halinde sıralanır, her kartın altında çizim alanı.', icon: <Layout size={24} /> },
  { id: 'document', label: 'Belge Modu', desc: 'Orijinal PDF düzeni korunur, soru dışındaki alanlar beyaz. Çözüm sağda açılır.', icon: <FileText size={24} /> },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onChange, onClose }) => {
  const update = (patch: Partial<AppSettings>) => {
    const next = saveSettings(patch);
    onChange(next);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary, #1c1c1e)', borderRadius: 20, padding: 0, width: 440, maxWidth: '92vw',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden', animation: 'scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary, #f5f5f7)' }}>Ayarlar</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary, #98989d)', transition: 'all 0.15s' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '20px 20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Solve layout selection */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary, #636366)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Çözme Ekranı Tasarımı</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {layouts.map(l => {
                const active = settings.solveLayout === l.id;
                return (
                  <button key={l.id} onClick={() => update({ solveLayout: l.id })} style={{
                    flex: 1, padding: '16px 14px', borderRadius: 14, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
                    background: active ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.04)',
                    border: active ? '2px solid rgba(10,132,255,0.5)' : '2px solid rgba(255,255,255,0.08)',
                    color: active ? '#0a84ff' : 'var(--text-secondary, #98989d)',
                    transition: 'all 0.2s', fontFamily: 'inherit',
                  }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(10,132,255,0.15)' : 'rgba(255,255,255,0.06)' }}>
                      {l.icon}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{l.label}</div>
                    <div style={{ fontSize: 10, lineHeight: 1.4, color: 'var(--text-tertiary, #636366)' }}>{l.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Palm rejection default */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f5f5f7)' }}>El Reddi (Palm Rejection)</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary, #636366)', marginTop: 2 }}>Dokunmatik ekranda el temasını yok say</div>
            </div>
            <button onClick={() => update({ palmRejection: !settings.palmRejection })} style={{
              width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', position: 'relative',
              background: settings.palmRejection ? '#30d158' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s',
            }}>
              <div style={{
                position: 'absolute', top: 2, left: settings.palmRejection ? 22 : 2,
                width: 24, height: 24, borderRadius: 12, background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
