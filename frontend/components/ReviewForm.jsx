import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { addDoc, collection } from 'firebase/firestore';

export default function ReviewForm({ lessonId, teacherId, studentId, onReviewSent }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, 'reviews'), {
      lesson_id: lessonId,
      teacher_id: teacherId,
      student_id: studentId,
      rating,
      comment,
      created_at: new Date()
    });
    setSent(true);
    onReviewSent && onReviewSent();
  };

  if (sent) {
    return (
      <div className="bg-green-50 text-green-700 border border-green-200 rounded p-3 text-sm">
        Merci pour votre avis ! Votre retour aide toute la communauté 👏
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 shadow flex flex-col gap-3 w-full max-w-md">
      <label className="font-medium text-gray-700 mb-1">
        Note :
        <div className="flex gap-1 mt-1">
          {[1,2,3,4,5].map(star => (
            <button
              key={star}
              type="button"
              className={`text-2xl ${star <= rating ? "text-yellow-400" : "text-gray-300"} hover:text-yellow-500 transition`}
              onClick={() => setRating(star)}
              aria-label={`${star} étoile${star>1?"s":""}`}
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
          className="w-full border border-gray-300 rounded px-3 py-2 mt-1 text-sm resize-none focus:ring-primary focus:border-primary"
          rows={2}
        />
      </div>
      <button
        type="submit"
        className="bg-primary text-white px-5 py-2 rounded font-semibold shadow hover:bg-primary-dark transition self-end"
      >
        Envoyer
      </button>
    </form>
  );
}