import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

const GUYANE_COMMUNES = [
  'Apatou','Awala-Yalimapo','Camopi','Cayenne','Grand-Santi','Iracoubo',
  'Kourou','Macouria','Mana','Maripasoula','Matoury',
  'Montsinéry-Tonnegrande','Ouanary','Papaïchton','Régina','Rémire-Montjoly',
  'Roura','Saint-Élie','Saint-Georges','Saint-Laurent-du-Maroni','Saül','Sinnamary',
];

export default function InfluencerProfile() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [influencerId, setInfluencerId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({
    firstName: '', lastName: '', email: '', phone: '', city: '',
    network: '', profileUrl: '', audienceSize: '',
  });

  // ── Auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { navigate('/influencer', { replace: true }); return; }
      const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (!snap.exists() || snap.data()?.role !== 'influencer') {
        await signOut(auth);
        navigate('/influencer', { replace: true });
        return;
      }
      const data = snap.data();
      setProfile({
        firstName:    data.firstName || (data.fullName ? data.fullName.split(' ')[0] : ''),
        lastName:     data.lastName  || (data.fullName ? data.fullName.split(' ').slice(1).join(' ') : ''),
        email:        data.email || firebaseUser.email || '',
        phone:        data.phone || '',
        city:         data.city || '',
        network:      data.network || '',
        profileUrl:   data.profileUrl || '',
        audienceSize: data.audienceSize || '',
      });
      setUid(firebaseUser.uid);

      // Récupère l'id du doc influencers pour sync du nom
      const q = query(collection(db, 'influencers'), where('uid', '==', firebaseUser.uid));
      const qSnap = await getDocs(q).catch(() => null);
      if (qSnap && !qSnap.empty) {
        setInfluencerId(qSnap.docs[0].id);
      } else {
        // Essai direct par uid
        const direct = await getDoc(doc(db, 'influencers', firebaseUser.uid)).catch(() => null);
        if (direct?.exists()) setInfluencerId(firebaseUser.uid);
      }

      setAuthLoading(false);
    });
    return () => unsub();
  }, [navigate]);

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!uid) return;
    setSaving(true);
    try {
      const fullName = ((profile.firstName || '').trim() + ' ' + (profile.lastName || '').trim()).trim();
      // ✅ Sanitize profileUrl : n'accepter que http(s) pour éviter javascript: en href
      const rawUrl = (profile.profileUrl || '').trim();
      const safeProfileUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
      await updateDoc(doc(db, 'users', uid), {
        firstName:    (profile.firstName || '').trim(),
        lastName:     (profile.lastName || '').trim(),
        fullName,
        phone:        (profile.phone || '').trim(),
        city:         (profile.city || '').trim(),
        network:      (profile.network || '').trim(),
        profileUrl:   safeProfileUrl,
        audienceSize: (profile.audienceSize || '').trim(),
      });
      // Sync nom dans influencers
      if (influencerId) {
        await updateDoc(doc(db, 'influencers', influencerId), { name: fullName }).catch(() => {});
      }
      alert('Profil mis a jour !');
    } catch (err) {
      alert("Erreur : " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Actions compte ──────────────────────────────────────────────────────
  const handleLogout = async () => { await signOut(auth); window.location.href = '/'; };

  const handleResetPassword = async () => {
    const email = profile.email || auth.currentUser?.email;
    if (!email) return alert("Pas d'adresse email trouvee.");
    await sendPasswordResetEmail(auth, email);
    alert('Email de reinitialisation envoye.');
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Supprimer definitivement votre compte ?\nCette action est irreversible.')) return;
    try {
      const idToken = await auth.currentUser.getIdToken(true);
      const r = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      alert('Compte supprime. A bientot !');
      window.location.href = '/';
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('requires-recent-login')) {
        const email = auth.currentUser?.email || '';
        const pwd = window.prompt('Par securite, entrez votre mot de passe (' + email + ') :');
        if (!pwd) return;
        const cred = EmailAuthProvider.credential(email, pwd);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await handleDeleteAccount();
      } else {
        alert('Erreur : ' + msg);
      }
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <DashboardLayout role="influencer">
      <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-lg p-8 border border-gray-100 mt-6">

        <h2 className="text-2xl font-bold text-primary mb-6 text-center">Mon Profil</h2>

        <form className="space-y-4" onSubmit={handleSave}>

          {/* Prenom / Nom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Prenom</label>
              <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.firstName}
                onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                required placeholder="ex : Marie" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Nom</label>
              <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.lastName}
                onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))}
                required placeholder="ex : Dupont" />
            </div>
          </div>

          {/* Email lecture seule */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Adresse email</label>
            <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-500">
              {profile.email || '—'}
            </div>
          </div>

          {/* Telephone */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Telephone</label>
            <PhoneInput
              international defaultCountry="GF"
              value={profile.phone}
              onChange={value => setProfile(p => ({ ...p, phone: value || '' }))}
            />
          </div>

          {/* Ville */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Ville (commune)</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.city}
              onChange={e => setProfile(p => ({ ...p, city: e.target.value }))}>
              <option value="">Selectionner...</option>
              {GUYANE_COMMUNES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Separateur */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Profil partenaire</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* Reseau */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Reseau principal</label>
            <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.network}
              onChange={e => setProfile(p => ({ ...p, network: e.target.value }))}
              placeholder="Instagram, TikTok, Facebook..." />
          </div>

          {/* Lien */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Lien profil / page</label>
            <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.profileUrl}
              onChange={e => setProfile(p => ({ ...p, profileUrl: e.target.value }))}
              placeholder="https://instagram.com/monprofil" />
          </div>

          {/* Audience */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Taille d'audience</label>
            <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.audienceSize}
              onChange={e => setProfile(p => ({ ...p, audienceSize: e.target.value }))}
              placeholder="ex : 5 000 abonnes" />
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60">
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </form>

        {/* Actions compte */}
        <div className="mt-8 flex flex-col gap-2">
          <button onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300 transition">
            Se deconnecter
          </button>
          <button onClick={handleResetPassword}
            className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200 transition">
            Changer de mot de passe
          </button>
          <button onClick={handleDeleteAccount} disabled={saving}
            className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200 transition disabled:opacity-60">
            Supprimer mon compte
          </button>
        </div>

      </div>
    </DashboardLayout>
  );
}