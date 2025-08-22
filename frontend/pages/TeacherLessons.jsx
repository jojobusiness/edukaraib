import React, { useEffect, useMemo, useRef, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ref as sRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

// --- helpers ---
const statusColors = {
  booked: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-gray-200 text-gray-700',
};

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const fmtFromSlot = (slot_day, slot_hour) =>
  `${slot_day || ''} ${slot_hour != null ? `• ${String(slot_hour).padStart(2, '0')}:00` : ''}`.trim();

/** essaie users/{uid} puis students/{id} pour obtenir le nom */
async function resolveStudentName(studentId) {
  if (!studentId) return 'Élève';
  try {
    const u = await getDoc(doc(db, 'users', studentId));
    if (u.exists()) {
      const d = u.data();
      return d.fullName || d.name || d.displayName || studentId;
    }
  } catch {}
  try {
    const s = await getDoc(doc(db, 'students', studentId));
    if (s.exists()) {
      const d = s.data();
      return d.full_name || d.name || studentId;
    }
  } catch {}
  return studentId;
}

function When({ l }) {
  if (l.start_datetime?.seconds) {
    return <span>📅 {fmtTime(l.start_datetime.seconds * 1000)}</span>;
  }
  if (l.slot_day || l.slot_hour != null) {
    return <span>📅 {fmtFromSlot(l.slot_day, l.slot_hour)}</span>;
  }
  return null;
}

function StatusPill({ status }) {
  const label =
    status === 'booked'
      ? 'En attente'
      : status === 'confirmed'
      ? 'Confirmé'
      : status === 'rejected'
      ? 'Refusé'
      : status === 'completed'
      ? 'Terminé'
      : status;

  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold ml-2 ${
        statusColors[status] || 'bg-gray-200'
      }`}
    >
      {label}
    </span>
  );
}

// --- Modal documents pour un cours ---
function DocumentsModal({ open, onClose, lesson, onUploaded }) {
  const [files, setFiles] = useState([]); // {id, filename, url, created_at}
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const fetchDocs = async () => {
      if (!open || !lesson?.id) return;
      setLoading(true);
      try {
        const qDocs = query(collection(db, 'documents'), where('lesson_id', '==', lesson.id));
        const snap = await getDocs(qDocs);
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
        setFiles(items);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, [open, lesson?.id]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !lesson?.id) return;
    setUploading(true);
    try {
      const path = `lessons/${lesson.id}/${Date.now()}_${file.name}`;
      const fileRef = sRef(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      // Enregistrement Firestore
      await addDoc(collection(db, 'documents'), {
        lesson_id: lesson.id,
        sender_id: auth.currentUser?.uid || null,
        filename: file.name,
        storage_path: path,
        url,
        created_at: serverTimestamp(),
      });

      // Notif à l'élève
      await addDoc(collection(db, 'notifications'), {
        user_id: lesson.student_id,
        type: 'document_shared',
        with_id: auth.currentUser?.uid || null,
        lesson_id: lesson.id,
        message: `Un nouveau document a été partagé pour votre cours ${lesson.subject_id || ''}.`,
        created_at: serverTimestamp(),
        read: false,
      });

      onUploaded?.();

      // recharge
      const qDocs = query(collection(db, 'documents'), where('lesson_id', '==', lesson.id));
      const snap = await getDocs(qDocs);
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
      setFiles(items);
    } catch (err) {
      console.error(err);
      alert("Échec de l'upload du document.");
    } finally {
      setUploading(false);
      e.target.value = ''; // reset
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

// --- Page principale ---
export default function TeacherLessons() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const nameCacheRef = useRef(new Map());

  // modal docs
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docModalLesson, setDocModalLesson] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      setLoading(true);
      try {
        const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
        const snapshot = await getDocs(qLessons);

        const raw = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

        const enriched = await Promise.all(
          raw.map(async (l) => {
            const sid = l.student_id;
            if (!sid) return { ...l, studentName: 'Élève' };
            if (nameCacheRef.current.has(sid)) {
              return { ...l, studentName: nameCacheRef.current.get(sid) };
            }
            const name = await resolveStudentName(sid);
            nameCacheRef.current.set(sid, name);
            return { ...l, studentName: name };
          })
        );

        // tri: les plus récents d'abord si date
        enriched.sort((a, b) => {
          const as = a.start_datetime?.seconds || 0;
          const bs = b.start_datetime?.seconds || 0;
          return bs - as;
        });

        setLessons(enriched);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, []);

  const handleStatus = async (id, status) => {
    // MAJ Firestore (+ horodatage si terminé)
    await updateDoc(doc(db, 'lessons', id), {
      status,
      ...(status === 'completed' ? { completed_at: serverTimestamp() } : {}),
    });

    // MAJ UI optimiste
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));

    // Trouver la leçon et infos prof
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;

    let profName = 'Votre professeur';
    try {
      const profSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (profSnap.exists()) profName = profSnap.data().fullName || profName;
    } catch {}

    // Préparer la notif
    let notifText = '';
    let notifType = '';
    if (status === 'confirmed') {
      notifText = `Votre cours avec ${profName} a été accepté !`;
      notifType = 'cours_accepted';
    } else if (status === 'rejected') {
      notifText = `Votre cours avec ${profName} a été refusé.`;
      notifType = 'cours_rejected';
    } else if (status === 'completed') {
      notifText = `Votre cours avec ${profName} est terminé.`;
      notifType = 'cours_completed';
    } else {
      return; // autres statuts: pas de notif
    }

    // Créer la notification côté élève
    await addDoc(collection(db, 'notifications'), {
      user_id: lesson.student_id,   // destinataire = élève
      type: notifType,
      with_id: auth.currentUser.uid,
      withName: profName,
      lesson_id: lesson.id,
      message: notifText,
      created_at: serverTimestamp(),
      read: false,
    });
  };

  const openDocs = (lesson) => {
    setDocModalLesson(lesson);
    setDocModalOpen(true);
  };

  const demandes = useMemo(() => lessons.filter((l) => l.status === 'booked'), [lessons]);
  const confirmes = useMemo(() => lessons.filter((l) => l.status === 'confirmed'), [lessons]);

  const Card = ({ l, showActions }) => (
    <div className="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row md:items-center gap-4 justify-between">
      <div className="flex-1">
        <div className="flex gap-2 items-center mb-1">
          <span className="font-bold text-primary">{l.subject_id || 'Matière'}</span>
          <StatusPill status={l.status} />
        </div>
        <div className="text-gray-700">
          Élève : <span className="font-semibold">{l.studentName}</span>
        </div>
        <div className="text-gray-500 text-sm"><When l={l} /></div>
      </div>

      {showActions ? (
        <div className="flex gap-2">
          <button
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => handleStatus(l.id, 'confirmed')}
          >
            ✅ Accepter
          </button>
          <button
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => handleStatus(l.id, 'rejected')}
          >
            ❌ Refuser
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => openDocs(l)}
          >
            📄 Documents
          </button>
          <button
            className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded shadow font-semibold"
            onClick={() => handleStatus(l.id, 'completed')}
            disabled={l.status === 'completed'}
            title={l.status === 'completed' ? 'Déjà terminé' : 'Marquer comme terminé'}
          >
            ✅ Terminé
          </button>
        </div>
      )}
    </div>
  );

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-6">Cours — Professeur</h2>

        {/* SECTION 1 : Demandes de cours (en attente) */}
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Demandes de cours</h3>
            <span className="text-sm text-gray-500">{demandes.length} en attente</span>
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Chargement…
            </div>
          ) : demandes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucune demande de cours pour le moment.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {demandes.map((l) => (
                <Card key={l.id} l={l} showActions />
              ))}
            </div>
          )}
        </section>

        {/* SECTION 2 : Gestion des cours (confirmés) */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-xl font-semibold">Gestion des cours</h3>
            <span className="text-sm text-gray-500">{confirmes.length} confirmés</span>
          </div>

          {loading ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Chargement…
            </div>
          ) : confirmes.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow text-gray-500 text-center">
              Aucun cours confirmé pour le moment.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {confirmes.map((l) => (
                <Card key={l.id} l={l} showActions={false} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Modal documents */}
      <DocumentsModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        lesson={docModalLesson}
        onUploaded={() => {}}
      />
    </DashboardLayout>
  );
}