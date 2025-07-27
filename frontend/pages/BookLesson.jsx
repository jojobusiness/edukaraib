import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';

export default function BookLesson({ teacherId, subjectId }) {
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const fetchChildren = async () => {
      const q = query(collection(db, 'students'), where('parent_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudents(data);
    };
    fetchChildren();
  }, []);

  const handleBook = async (e) => {
    e.preventDefault();
    if (!date || !studentId) return alert('Tous les champs sont requis.');

    await addDoc(collection(db, 'lessons'), {
      student_id: studentId,
      teacher_id: teacherId,
      subject_id: subjectId,
      start_datetime: new Date(date),
      status: 'booked',
      is_paid: false
    });

    alert('Cours réservé avec succès !');
    setStudentId('');
    setDate('');
  };

  return (
    <div>
      <h3>Réserver un cours pour un enfant</h3>
      <form onSubmit={handleBook}>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
          <option value="">-- Choisir un enfant --</option>
          {students.map(child => (
            <option key={child.id} value={child.id}>
              {child.full_name} ({child.school_level})
            </option>
          ))}
        </select>
        <br />
        <label>Date et heure du cours :</label>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <br />
        <button type="submit">Réserver</button>
      </form>
    </div>
  );
}