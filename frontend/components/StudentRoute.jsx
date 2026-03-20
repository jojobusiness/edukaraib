import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export default function StudentRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setAuthorized(snap.exists() && snap.data()?.role === 'student');
      } catch {}
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Chargement…</div>;
  if (!authorized) return <Navigate to="/" replace />;
  return children;
}