import { useEffect, useState } from 'react';
import type { Media } from '../model/types';
import { useStore } from '../store/store';

// Renders a media record: image, audio, video or a download link. The bytes come from
// wherever the backend keeps them (IndexedDB in local mode, a signed Storage URL in cloud
// mode). A relative's page passes its own resolver, which goes through the invite API.
export default function MediaItem({ m, resolve }: { m: Media; resolve?: (m: Media) => Promise<string | null> }) {
  const { backend } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let cancelled = false;
    (async () => {
      const got = await (resolve ? resolve(m) : backend.mediaUrl(m));
      if (cancelled) return;
      if (got) { u = got; setUrl(got); } else setMissing(true);
    })();
    return () => { cancelled = true; if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); };
  }, [m, resolve, backend]);
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><strong>{m.title}</strong><span className="pill">{m.kind}</span></div>
      {m.caption && <p className="muted" style={{ margin: '4px 0' }}>{m.caption}</p>}
      {missing && <p className="muted">The file for this item is not available here (it may be on the device where it was added, in local mode).</p>}
      {url && m.kind === 'photo' && <img src={url} alt={m.title} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />}
      {url && m.kind === 'audio' && <audio controls src={url} style={{ width: '100%', marginTop: 6 }} />}
      {url && m.kind === 'video' && <video controls src={url} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />}
      {url && (m.kind === 'document' || m.kind === 'letter') && <a className="btn small" href={url} download={m.title} target="_blank" rel="noreferrer" style={{ marginTop: 6, display: 'inline-block' }}>Open</a>}
    </div>
  );
}
