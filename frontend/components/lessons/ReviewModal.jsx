import React, { useEffect, useState } from 'react';
import { auth, db } from '../../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export default function ReviewModal({ open, onClose, lesson, onSent }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(5);
      setComment('');
      setSending(false);
    }
  }, [open]);

  const submit = async () => {
    if (!lesson?.id) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'reviews'), {
        lesson_id: lesson.id,
        student_id: lesson.student_id,           // avis au nom de l'enfant
        teacher_id: lesson.teacher_id,
        rating: Number(rating),
        comment: comment.trim(),
        created_at: serverTimestamp(),
        left_by_parent_id: auth.currentUser?.uid || null,
      });

      await addDoc(collection(db, 'notifications'), {
        user_id: lesson.teacher_id,
        type: 'review_left',
        with_id: lesson.student_id,              // auteur réel = élève
        lesson_id: lesson.id,
        message: `Un nouvel avis a été laissé pour le cours (${lesson.subject_id || 'Cours'}).`,
        created_at: serverTimestamp(),
        read: false,
      });

      onSent?.();
      onClose();
    } catch (e) {
      console.error(e);
      alert("Impossible d'envoyer l'avis pour le moment.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Laisser un avis (au nom de {lesson?.studentName})</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Note</label>
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-full border rounded-lg p-2"
            >
              {[5,4,3,2,1].map(n => (
                <option key={n} value={n}>{n} / 5</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Commentaire (optionnel)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="w-full border rounded-lg p-2"
              placeholder="Partagez le ressenti de votre enfant…"
            />
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-primary text-white hover:opacity-90"
          >
            {sending ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}