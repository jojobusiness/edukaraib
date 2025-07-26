import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function Search() {
  const [teachers, setTeachers] = useState([]);

  useEffect(() => {
    const fetchTeachers = async () => {
      const querySnapshot = await getDocs(collection(db, 'teachers'));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeachers(data);
    };
    fetchTeachers();
  }, []);

  return (
    <div>
      <h2>Rechercher un professeur</h2>
      <ul>
        {teachers.map((teacher) => (
          <li key={teacher.id}>
            {teacher.bio} - {teacher.location} - {teacher.price_per_hour} €/h
          </li>
        ))}
      </ul>
    </div>
  );
}