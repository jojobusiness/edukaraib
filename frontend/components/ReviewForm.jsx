import React, { useState } from 'react';
import { db, auth } from '../lib/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';

export default function ReviewForm({ lessonId, teacherId, studentId, onReviewSent }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // 1) Vérifier l’existence de la leçon
      const lessonRef = doc(db, 'lessons', String(lessonId || ''));
      const lessonSnap = await getDoc(lessonRef);
      if (!lessonSnap.exists()) {
        setError("Le cours n'existe pas.");
        setSubmitting(false);
        return;
      }

      const lesson = lessonSnap.data();

      // 2) Concordance prof
      if (String(lesson.teacher_id || '') !== String(teacherId || '')) {
        setError("Ce cours n'appartient pas à ce professeur.");
        setSubmitting(false);
        return;
      }

      // 3) Cours terminé
      if (String(lesson.status || '') !== 'completed') {
        setError("Vous ne pouvez laisser un avis qu'après la fin du cours.");
        setSubmitting(false);
        return;
      }

      // 4) L'élève est bien concerné par ce cours
      const isGroup = Array.isArray(lesson.participant_ids) && lesson.participant_ids.length > 0;
      const belongsToIndividual = !isGroup && String(lesson.student_id || '') === String(studentId || '');
      const belongsToGroup = isGroup && (lesson.participant_ids || []).map(String).includes(String(studentId || ''));

      if (!belongsToIndividual && !belongsToGroup) {
        setError("Cet élève n'est pas rattaché à ce cours.");
        setSubmitting(false);
        return;
      }

      // 👉 Tout est conforme : on enregistre l’avis (plusieurs avis possibles)
      await addDoc(collection(db, 'reviews'), {
        lesson_id: lessonId,
        teacher_id: teacherId,

        // auteur "élève/enfant"
        student_id: studentId,

        // ✅ auteur connecté (parent ou élève)
        left_by_parent_id: auth.currentUser?.uid || null,

        rating,
        comment: String(comment || '').trim(),
        created_at: serverTimestamp(),

        lesson_status: lesson.status,
        lesson_is_group: !!isGroup,
        slot_day: lesson.slot_day || null,
        slot_hour: lesson.slot_hour ?? null,
        subject_id: lesson.subject_id || null,
      });

      // 1) Récupère le token Firebase (obligatoire pour verifyAuth)
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        console.warn("No auth token => promo API skipped");
      } else {
        // 2) Appel API Vercel (crée promo + notif + email)
        const resp = await fetch("/api/create-promo-first-review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId }),
        });

        let data = null;
        try { data = await resp.json(); } catch {}

        console.log("PROMO API status:", resp.status, "data:", data);

        if (data?.ok && data?.code) {
          alert(
            data.already
              ? `Ton code promo est toujours actif : ${data.code}`
              : `🎉 Merci ! Voici ton code promo : ${data.code} ( +1h sur pack 5h )`
          );
        } else {
          alert(`Promo non créée : ${data?.error || "erreur inconnue"}`);
        }
      }

      setSent(true);
      setSubmitting(false);
      onReviewSent && onReviewSent();
    } catch (err) {
      console.error('send review error:', err);
      setError("Impossible d'envoyer l'avis. Réessayez plus tard.");
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="bg-green-50 text-green-700 border border-green-200 rounded p-3 text-sm">
        Merci pour votre avis ! Votre retour aide toute la communauté 👏
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 shadow flex flex-col gap-3 w-full max-w-md">
      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <label className="font-medium text-gray-700 mb-1">
        Note :
        <div className="flex gap-1 mt-1">
          {[1,2,3,4,5].map(star => (
            <button
              key={star}
              type="button"
              className={`text-2xl ${star <= rating ? "text-yellow-400" : "text-gray-300"} hover:text-yellow-500 transition`}
              onClick={() => setRating(star)}
              aria-label={`${star} étoile${star>1?"s":""}`}
              disabled={submitting}
            >
              ★
            </button>
          ))}
        </div>
      </label>

      <div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Votre avis sur le cours..."
          required
          className="w-full border border-gray-300 rounded px-3 py-2 mt-1 text-sm resize-none focus:ring-primary focus:border-primary disabled:opacity-60"
          rows={3}
          disabled={submitting}
        />
      </div>

      <button
        type="submit"
        className="bg-primary text-white px-5 py-2 rounded font-semibold shadow hover:bg-primary-dark transition self-end disabled:opacity-60"
        disabled={submitting}
      >
        {submitting ? 'Envoi…' : 'Envoyer'}
      </button>
    </form>
  );
}