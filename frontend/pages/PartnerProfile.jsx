import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { PARTNER_ROLE } from '../../api/_partners.mjs';

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2';

export default function PartnerProfile() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '', phone: '', city: '', structure: '' });
  const set = (k) => (e) => setProfile((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/partenaire', { replace: true }); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists() || snap.data()?.role !== PARTNER_ROLE) {
          await signOut(auth);
          navigate('/partenaire', { replace: true });
          return;
        }
        const d = snap.data();
        setProfile({
          firstName: d.firstName || '',
          lastName: d.lastName || '',
          email: d.email || user.email || '',
          phone: d.phone || '',
          city: d.city || '',
          structure: d.partner_structure || '',
        });
        setUid(user.uid);
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, [navigate]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!uid) return;
    setSaving(true);
    try {
      const firstName = profile.firstName.trim();
      const lastName = profile.lastName.trim();
      await updateDoc(doc(db, 'users', uid), {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        phone: profile.phone.trim(),
        city: profile.city.trim(),
      });
      toast.success('Profil mis à jour.');
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile.email) { toast.error('Aucune adresse email trouvée.'); return; }
    await sendPasswordResetEmail(auth, profile.email);
    toast.success('Mail de changement de mot de passe envoyé.');
  };

  const callDeleteAccount = async () => {
    const idToken = await auth.currentUser.getIdToken(true);
    const r = await fetch('/api/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Supprimer définitivement votre compte partenaire ?\nCette action est irréversible.')) return;
    try {
      await callDeleteAccount();
      window.location.href = '/';
    } catch (err) {
      if (!String(err?.message || '').includes('requires-recent-login')) { toast.error(`Erreur : ${err.message}`); return; }
      const email = auth.currentUser?.email || '';
      const pwd = window.prompt(`Par sécurité, saisissez votre mot de passe (${email}) :`);
      if (!pwd) return;
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(email, pwd));
      await callDeleteAccount();
      window.location.href = '/';
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
        <h2 className="text-2xl font-bold text-primary mb-1 text-center">Mon profil</h2>
        {profile.structure && <p className="text-center text-gray-500 mb-6">{profile.structure}</p>}

        <form className="space-y-4" onSubmit={handleSave}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">Prénom
              <input className={`${inputCls} mt-1`} value={profile.firstName} onChange={set('firstName')} required />
            </label>
            <label className="block text-sm font-medium text-gray-700">Nom
              <input className={`${inputCls} mt-1`} value={profile.lastName} onChange={set('lastName')} />
            </label>
          </div>
          <div>
            <span className="block mb-1 text-sm font-medium text-gray-700">Adresse email</span>
            <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-500">{profile.email || '—'}</div>
          </div>
          <label className="block text-sm font-medium text-gray-700">Téléphone
            <input type="tel" className={`${inputCls} mt-1`} value={profile.phone} onChange={set('phone')} />
          </label>
          <label className="block text-sm font-medium text-gray-700">Commune
            <input className={`${inputCls} mt-1`} value={profile.city} onChange={set('city')} placeholder="ex : Cayenne" />
          </label>
          <button type="submit" disabled={saving} className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        <div className="mt-8 flex flex-col gap-2">
          <button type="button" onClick={async () => { await signOut(auth); window.location.href = '/'; }} className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300">Se déconnecter</button>
          <button type="button" onClick={handleResetPassword} className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200">Changer de mot de passe</button>
          <button type="button" onClick={handleDeleteAccount} className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200">Supprimer mon compte</button>
        </div>
      </div>
    </DashboardLayout>
  );
}
