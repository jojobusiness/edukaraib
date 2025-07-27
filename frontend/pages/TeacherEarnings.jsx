import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

export default function TeacherEarnings() {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      const q = query(collection(db, 'lessons'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => doc.data());

      const paidCourses = data.filter(c => c.is_paid);
      const totalEarnings = paidCourses.reduce((sum, c) => sum + parseFloat(c.price_per_hour || 0), 0);
      setTotal(totalEarnings);
    };
    fetch();
  }, []);

  return (
    <div>
      <h2>Revenus générés</h2>
      <p>Total : {total.toFixed(2)} €</p>
    </div>
  );
}