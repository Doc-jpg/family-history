import { useEffect, useState } from 'react';
import type { Media } from '../model/types';
import { getFile } from '../store/media';

// Renders a media record: image, audio, video or a download link. Local mode reads the bytes
// from IndexedDB on this device; cloud mode will fetch a signed URL from Storage.
export default function MediaItem({ m }: { m: Media }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    (async () => {
      if (m.dataUrl) { setUrl(m.dataUrl); return; }
      if (m.storagePath?.startsWith('local:')) {
        const blob = await getFile(m.storagePath.slice(6));
        if (blob) { u = URL.createObjectURL(blob); setUrl(u); } else setMissing(true);
      }
    })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [m]);
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><strong>{m.title}</strong><span className="pill">{m.kind}</span></div>
      {m.caption && <p className="muted" style={{ margin: '4px 0' }}>{m.caption}</p>}
      {missing && <p className="muted">The file for this item is on the device where it was added (local mode). It will travel with cloud mode.</p>}
      {url && m.kind === 'photo' && <img src={url} alt={m.title} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />}
      {url && m.kind === 'audio' && <audio controls src={url} style={{ width: '100%', marginTop: 6 }} />}
      {url && m.kind === 'video' && <video controls src={url} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />}
      {url && (m.kind === 'document' || m.kind === 'letter') && <a className="btn small" href={url} download={m.title} style={{ marginTop: 6, display: 'inline-block' }}>Download</a>}
    </div>
  );
}
