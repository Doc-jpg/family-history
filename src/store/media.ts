// Media storage. Local mode keeps the bytes in IndexedDB on this device (browser storage is
// far too small for video); the Media record in the dataset carries only the id, kind and
// caption. Cloud mode uploads to the private Supabase Storage bucket "family-media" under
// contributions/<invitationId>/ and stores the object path on the record instead.

const DB = 'family-history-media';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(id: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getFile(id: string): Promise<Blob | undefined> {
  try {
    const db = await open();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result as Blob | undefined);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return blob;
  } catch {
    return undefined;
  }
}

export function kindOf(file: File): 'photo' | 'document' | 'audio' | 'video' {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

export const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB per file in local mode; cloud limit set on the bucket
export const ACCEPT = 'image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.rtf';

/** Record a voice memo with the microphone. Returns a stop() that resolves to the audio blob. */
export async function startRecording(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        };
        rec.stop();
      }),
  };
}
