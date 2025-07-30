import React, { useState } from 'react';
import { auth, db } from '../lib/firebase';
import { addDoc, collection } from 'firebase/firestore';

export default function BookLessonEleve({ teacherId, subjectId }) {
  const [date, setDate] = useState('');

  const handleBook = async (e) => {
    e.preventDefault();
    if (!date) return alert("Choisis une date !");
    await addDoc(collection(db, 'lessons'), {
      student_id: auth.currentUser.uid,
      teacher_id: teacherId,
      subject_id: subjectId,
      start_datetime: new Date(date),
      status: 'booked',
      is_paid: false
    });
    alert('Cours réservé !');
    setDate('');
  };

  return (
    <div>
      <h2>Réserver un cours</h2>
      <form onSubmit={handleBook}>
        <label>Date :</label>
        <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required />
        <button type="submit">Réserver</button>
      </form>
    </div>
  );
}