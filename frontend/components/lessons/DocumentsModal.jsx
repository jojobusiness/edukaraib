import React, { useEffect, useState } from 'react';
import { auth, db, storage } from '../../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- EMAIL HELPER (DocumentsModal) ---
async function getEmail(uid) {
  try {
    const s = await getDoc(doc(db, "users", uid));
    if (s.exists()) {
      const d = s.data();
      return d.email || null;
    }
  } catch {}
  return null;
}
async function notifyEmail(to, { title, message, ctaUrl, ctaText = "Ouvrir" }) {
  if (!to) return;
  await fetch("/api/notify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, title, message, ctaUrl, ctaText }),
  }).catch(() => {});
}
// --- /EMAIL HELPER ---

export default function DocumentsModal({
  open,
  onClose,
  lesson,
  allowUpload = true, // côté prof = true ; côté parent/élève = false
  onUploaded,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // ---- util ----
  async function refreshList() {
    if (!lesson?.id) return;
    const qDocs = query(collection(db, 'documents'), where('lesson_id', '==', lesson.id));
    const snap = await getDocs(qDocs);
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    setFiles(items);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!open || !lesson?.id) return;
      setLoading(true);
      try {
        await refreshList();
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, lesson?.id]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !lesson?.id) return;
    setUploading(true);
    try {
      // 1) Upload Storage
      const path = `lessons/${lesson.id}/${Date.now()}_${file.name}`;
      const fileRef = sRef(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      // 2) Enregistrement document
      await addDoc(collection(db, 'documents'), {
        lesson_id: lesson.id,
        sender_id: auth.currentUser?.uid || null,
        filename: file.name,
        storage_path: path,
        url,
        created_at: serverTimestamp(),
      });

      // 3) Notifications — élève principal + tous les participants
      const recipients = new Set();
      if (lesson.student_id) recipients.add(lesson.student_id);
      if (Array.isArray(lesson.participant_ids)) {
        lesson.participant_ids.forEach((id) => id && recipients.add(id));
      }

      const notifWrites = [];
      const message = `Un nouveau document a été partagé pour votre cours ${lesson.subject_id || ''}.`;
      for (const uid of recipients) {
        notifWrites.push(
          addDoc(collection(db, 'notifications'), {
            user_id: uid,
            type: 'document_shared',
            with_id: auth.currentUser?.uid || null,
            lesson_id: lesson.id,
            message,
            created_at: serverTimestamp(),
            read: false,
          })
        );
      }
      if (notifWrites.length) {
        await Promise.allSettled(notifWrites);
      }

      // après écriture Firestore réussie :
      for (const uid of (lesson.participant_ids || [lesson.student_id]).filter(Boolean)) {
        const to = await getEmail(uid);
        await notifyEmail(to, {
          title: "Nouveau document de cours",
          message: `Un document a été ajouté pour votre cours ${lesson.subject_id || ""}.`,
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: "Ouvrir le cours",
        });
      }

      onUploaded?.();

      // 4) Refresh liste
      await refreshList();
    } catch (err) {
      console.error(err);
      alert("Échec de l'upload du document.");
    } finally {
      setUploading(false);
      if (e?.target) e.target.value = '';
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Documents — {lesson?.subject_id || 'Cours'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {allowUpload && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Ajouter un document (PDF, images, etc.)
              </label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx"
                onChange={handleUpload}
                disabled={uploading}
                className="block w-full text-sm"
              />
              {uploading && <p className="text-sm text-gray-500 mt-2">Envoi en cours…</p>}
            </div>
          )}

          <div>
            <h4 className="font-medium mb-2">Partagés ({files.length})</h4>
            {loading ? (
              <div className="text-gray-500">Chargement…</div>
            ) : files.length === 0 ? (
              <div className="text-gray-500">Aucun document pour ce cours.</div>
            ) : (
              <ul className="divide-y">
                {files.map((f) => (
                  <li key={f.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{f.filename}</div>
                      <div className="text-xs text-gray-500">
                        {f.created_at?.seconds
                          ? new Date(f.created_at.seconds * 1000).toLocaleString('fr-FR')
                          : '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline font-semibold"
                      >
                        Ouvrir ⤴
                      </a>
                      <a
                        href={f.url}
                        download={f.filename || true}
                        className="bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-sm font-semibold"
                      >
                        ⬇️ Télécharger
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}