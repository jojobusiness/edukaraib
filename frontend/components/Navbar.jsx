import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';

// 👉 MAPPING vers tes routes réelles (depuis ton DashboardLayout)
const ROLE_PATH = {
  student:    '/dashboard-eleve',
  parent:     '/parent/dashboard',
  teacher:    '/prof/dashboard',
  admin:      '/admin/dashboard',
  influencer: '/influencer/dashboard',
};

async function getUserRole(uid) {
  try {
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) {
      const d = s.data();
      if (typeof d.role === 'string') return d.role;
      if (Array.isArray(d.roles) && d.roles.length) return d.roles[0];
      if (typeof d.type === 'string') return d.type;
    }
  } catch {}
  try {
    const q = query(collection(db, 'users'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0].data();
      if (typeof d.role === 'string') return d.role;
      if (Array.isArray(d.roles) && d.roles.length) return d.roles[0];
      if (typeof d.type === 'string') return d.type;
    }
  } catch {}
  return null;
}

export default function Navbar() {
  const [user, setUser] = useState(() => auth.currentUser);
  const [resolving, setResolving] = useState(false);
  const [dashPath, setDashPath] = useState('/profile');
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) return;
      setResolving(true);
      const role = await getUserRole(u.uid);
      const path = ROLE_PATH[role] || '/profile';
      setDashPath(path);
      setResolving(false);
    });
    return () => unsub();
  }, []);

  const goAccount = useCallback(async () => {
    if (!user) return navigate('/login');
    if (!resolving && dashPath) return navigate(dashPath, { replace: false });
    setResolving(true);
    const role = await getUserRole(user.uid);
    const path = ROLE_PATH[role] || '/profile';
    setDashPath(path);
    setResolving(false);
    navigate(path, { replace: false });
  }, [user, dashPath, resolving, navigate]);

  return (
    <nav className="bg-white shadow-md py-4 px-6 flex justify-between items-center">
      <Link to="/" className="text-xl font-bold text-primary">EduKaraib</Link>
      <div className="flex gap-2 sm:gap-4 items-center">

        {user ? (
          <button
            onClick={goAccount}
            disabled={resolving}
            className="text-gray-700 hover:text-primary disabled:opacity-50 text-sm"
            aria-busy={resolving ? 'true' : 'false'}
          >
            {resolving ? '…' : 'Mon compte'}
          </button>
        ) : (
          <>
            <Link to="/login" className="text-gray-700 hover:text-primary text-sm">Connexion</Link>
            <Link to="/register?role=teacher" className="bg-green-500 hover:bg-green-600 text-white font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg shadow transition text-sm">
              🎓 Donner des cours
            </Link>
          </>
        )}
        
      </div>
    </nav>
  );
}