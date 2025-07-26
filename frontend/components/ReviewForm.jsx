import React, { useState } from 'react';
import { db } from '../firebase';
import { addDoc, collection } from 'firebase/firestore';

export default function ReviewForm({ lessonId, teacherId, studentId, onReviewSent }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

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
    alert('Merci pour votre avis !');
    onReviewSent();
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>Note :
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map(r => (
            <option key={r} value={r}>{r} étoile(s)</option>
          ))}
        </select>
      </label>
      <br />
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Votre avis..." required />
      <br />
      <button type="submit">Envoyer</button>
    </form>
  );
}