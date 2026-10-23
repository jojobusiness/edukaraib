import React, { useEffect, useState } from 'react';
import { auth, db, storage } from '../../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  arrayUnion,
} from 'firebase/firestore';
import {
  ref as sRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { envoyerMail } from '../../lib/profils';
import { accesDuCours } from '../../lib/accesCours';
import { toast } from 'sonner';
import { confirmer } from '../ui/Dialogues';

/* =========================
   EMAIL HELPERS (même logique que TeacherLessons.jsx)
   ========================= */

// 🔒 23/10/2026 : on écrit à des IDENTIFIANTS, le serveur trouve les adresses
// (pour un enfant, celle de son parent). Le navigateur ne lit plus jamais
// l'e-mail de quelqu'un d'autre. Voir lib/profils.js → envoyerMail.
async function sendEmailsToUsers(userIds = [], { title, message, ctaUrl, ctaText = 'Ouvrir' }, lessonCtx = null) {
  const participants = Array.isArray(lessonCtx?.participant_ids) ? lessonCtx.participant_ids : [];
  await envoyerMail([...userIds, ...participants], {
    title,
    message,
    ctaUrl: ctaUrl || `${window.location.origin}/smart-dashboard`,
    ctaText,
  });
}

/* =========================
   MODAL DOCUMENTS
   ========================= */

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

  // Edition (renommer)
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  async function refreshList() {
    if (!lesson?.id) return;
    const moi = auth.currentUser?.uid;
    if (!moi) return;
    // 🔒 23/10/2026 : on ne lit que les documents auxquels on a accès (règle
    // Firestore). Filtre du cours côté navigateur : une seule condition =
    // pas d'index composite à maintenir.
    const qDocs = query(collection(db, 'documents'), where('acces', 'array-contains', moi));
    const snap = await getDocs(qDocs);
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => d.lesson_id === lesson.id);
    items.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
    setFiles(items);

    // Un élève qui rejoint le cours après l'envoi d'un fichier doit le voir aussi :
    // quand le prof ouvre la fenêtre, on complète l'accès des fichiers existants.
    if (lesson.teacher_id === moi) {
      const attendus = accesDuCours(lesson, moi);
      await Promise.allSettled(items.map((d) => {
        const manquants = attendus.filter((id) => !(d.acces || []).includes(id));
        return manquants.length
          ? updateDoc(doc(db, 'documents', d.id), { acces: arrayUnion(...manquants) })
          : null;
      }));
    }
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
    return () => {
      cancelled = true;
    };
  }, [open, lesson?.id]);

  // Upload d’un document
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
      const docRef = await addDoc(collection(db, 'documents'), {
        lesson_id: lesson.id,
        sender_id: auth.currentUser?.uid || null,
        filename: file.name,
        storage_path: path,
        url,
        created_at: serverTimestamp(),
        acces: accesDuCours(lesson, auth.currentUser?.uid),
      });

      // 3) Notifications in-app — élève principal + tous les participants
      const notifRecipients = new Set();
      if (lesson.student_id) notifRecipients.add(lesson.student_id);
      if (Array.isArray(lesson.participant_ids)) {
        lesson.participant_ids.forEach((id) => id && notifRecipients.add(id));
      }
      const notifWrites = [];
      const messageNotif = `Un nouveau document a été partagé pour votre cours ${lesson.subject_id || ''}.`;
      for (const uid of notifRecipients) {
        notifWrites.push(
          addDoc(collection(db, 'notifications'), {
            user_id: uid,
            type: 'document_shared',
            with_id: auth.currentUser?.uid || null,
            lesson_id: lesson.id,
            message: messageNotif,
            created_at: serverTimestamp(),
            read: false,
          })
        );
      }
      if (notifWrites.length) await Promise.allSettled(notifWrites);

      // 4) Emails — même logique que Prof/Lessons
      const isGroup =
        !!lesson?.is_group ||
        (Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0);

      const emailRecipients = new Set();
      if (isGroup) {
        (lesson.participant_ids || []).forEach((sid) => sid && emailRecipients.add(sid));
      } else if (lesson?.student_id) {
        emailRecipients.add(lesson.student_id);
      }

      const mailTitle = 'Nouveau document disponible';
      const mailMsg = `Un document (« ${file.name} ») est disponible pour votre cours ${lesson?.subject_id || ''}.`;
      await sendEmailsToUsers(
        Array.from(emailRecipients),
        {
          title: mailTitle,
          message: mailMsg,
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: 'Voir le document',
        },
        lesson
      );

      onUploaded?.();

      // 5) Refresh liste
      await refreshList();
    } catch (err) {
      console.error(err);
      toast.error("Échec de l'upload du document.");
    } finally {
      setUploading(false);
      if (e?.target) e.target.value = '';
    }
  };

  // Renommer un document
  const startEdit = (f) => {
    setEditingId(f.id);
    setEditingName(f.filename || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = async (f) => {
    if (!editingName.trim()) return;
    try {
      await updateDoc(doc(db, 'documents', f.id), {
        filename: editingName.trim(),
      });

      // Email (optionnel) — prévenir les mêmes destinataires
      const isGroup =
        !!lesson?.is_group ||
        (Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0);
      const emailRecipients = new Set();
      if (isGroup) {
        (lesson.participant_ids || []).forEach((sid) => sid && emailRecipients.add(sid));
      } else if (lesson?.student_id) {
        emailRecipients.add(lesson.student_id);
      }
      await sendEmailsToUsers(
        Array.from(emailRecipients),
        {
          title: 'Document mis à jour',
          message: `Le document « ${editingName.trim()} » a été mis à jour.`,
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: 'Ouvrir',
        },
        lesson
      );

      await refreshList();
    } catch (e) {
      console.error(e);
      toast.error('Impossible de renommer le document.');
    } finally {
      cancelEdit();
    }
  };

  // Supprimer un document (Firestore + Storage)
  const removeDoc = async (f) => {
    if (!(await confirmer({ titre: 'Supprimer ce document ?', message: f.filename || '', libelleConfirmer: 'Supprimer', danger: true }))) return;
    try {
      // Supprimer d’abord le fichier Storage si possible
      if (f.storage_path) {
        try {
          await deleteObject(sRef(storage, f.storage_path));
        } catch (e) {
          // si pas trouvé en storage, on continue quand même
          console.warn('Storage delete skipped:', e?.message || e);
        }
      }
      // Puis la doc Firestore
      await deleteDoc(doc(db, 'documents', f.id));

      // Email (optionnel) — prévenir les mêmes destinataires
      const isGroup =
        !!lesson?.is_group ||
        (Array.isArray(lesson?.participant_ids) && lesson.participant_ids.length > 0);
      const emailRecipients = new Set();
      if (isGroup) {
        (lesson.participant_ids || []).forEach((sid) => sid && emailRecipients.add(sid));
      } else if (lesson?.student_id) {
        emailRecipients.add(lesson.student_id);
      }
      await sendEmailsToUsers(
        Array.from(emailRecipients),
        {
          title: 'Document supprimé',
          message: `Le document « ${f.filename || 'document'} » a été supprimé.`,
          ctaUrl: `${window.location.origin}/smart-dashboard`,
          ctaText: 'Ouvrir',
        },
        lesson
      );

      await refreshList();
    } catch (e) {
      console.error(e);
      toast.error('Impossible de supprimer ce document.');
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
                  <li key={f.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {editingId === f.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="border rounded px-2 py-1 text-sm w-56"
                          />
                          <button
                            onClick={() => saveEdit(f)}
                            className="px-3 py-1 rounded bg-primary text-white text-sm font-semibold"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 rounded bg-gray-100 text-sm font-semibold"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="font-medium truncate">{f.filename}</div>
                          <div className="text-xs text-gray-500">
                            {f.created_at?.seconds
                              ? new Date(f.created_at.seconds * 1000).toLocaleString('fr-FR')
                              : '—'}
                          </div>
                        </>
                      )}
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
                      {allowUpload && editingId !== f.id && (
                        <>
                          <button
                            onClick={() => startEdit(f)}
                            className="px-3 py-1 rounded text-sm font-semibold bg-yellow-100 hover:bg-yellow-200"
                          >
                            Renommer
                          </button>
                          <button
                            onClick={() => removeDoc(f)}
                            className="px-3 py-1 rounded text-sm font-semibold bg-red-100 hover:bg-red-200 text-red-700"
                          >
                            Supprimer
                          </button>
                        </>
                      )}
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