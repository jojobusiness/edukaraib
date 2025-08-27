import React, { useEffect, useState, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  ref as sRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  deleteUser,
} from 'firebase/auth';

import TeacherAvailabilityEditor from '../components/TeacherAvailabilityEditor'; // composant dispo prof

// ------- helpers API signées (Stripe Connect) -------
async function fetchWithAuth(url, opts = {}) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let data; try { data = await res.json(); } catch {}
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

// ------- sous-composant statut Stripe -------
function PaymentStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWithAuth('/api/connect-status');
      setStatus(data);
    } catch (e) {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-gray-500">Chargement du statut…</p>;
  if (!status || !status.exists) {
    return <p className="text-gray-600">Paiements non configurés.</p>;
  }

  return (
    <div className="text-sm text-gray-700 space-y-1">
      <div>
        Charges activées :{' '}
        <b className={status.charges_enabled ? 'text-emerald-600' : 'text-red-600'}>
          {status.charges_enabled ? 'oui' : 'non'}
        </b>
      </div>
      <div>
        Payouts (virements) :{' '}
        <b className={status.payouts_enabled ? 'text-emerald-600' : 'text-red-600'}>
          {status.payouts_enabled ? 'oui' : 'non'}
        </b>
      </div>
      {!status.details_submitted && (
        <div className="text-amber-600">
          Infos à compléter : {status.requirements_due?.join(', ') || '—'}
        </div>
      )}
      <button
        onClick={load}
        className="mt-2 text-xs underline text-gray-500 hover:text-gray-700"
      >
        Rafraîchir le statut
      </button>
    </div>
  );
}

export default function Profile() {
  const [userLoaded, setUserLoaded] = useState(false);
  const [profile, setProfile] = useState({
    uid: '',
    email: '',
    role: '',
    fullName: '',
    phone: '',
    city: '',
    bio: '',
    avatarUrl: '',
    level: '',
    birth: '',
    subjects: '',
    diploma: '',
    price_per_hour: '',
    availability: {},
    // champs stripe (miroir, mis à jour par serveur/webhook)
    stripeAccountId: '',
    stripePayoutsEnabled: false,
    stripeChargesEnabled: false,
    stripeDetailsSubmitted: false,
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving, setSaving] = useState(false);

  // Charger l'utilisateur + profil
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setUserLoaded(true); return; }
      try {
        const ref = doc(db, 'users', u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setProfile((prev) => ({
            ...prev,
            ...data,
            uid: u.uid,
            email: data.email || u.email || '',
            role: data.role || data.type || prev.role || 'student',
          }));
        } else {
          // fallback minimal si doc absent
          setProfile((prev) => ({
            ...prev,
            uid: u.uid,
            email: u.email || '',
          }));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setUserLoaded(true);
      }
    });
    return () => unsub();
  }, []);

  // champs dynamiques selon rôle
  const baseFields = [
    { name: 'fullName', label: 'Nom complet', required: true, type: 'text' },
    { name: 'phone', label: 'Téléphone', type: 'tel' },
    { name: 'city', label: 'Ville', type: 'text' },
  ];
  if (profile.role === 'student') {
    baseFields.push({ name: 'level', label: 'Niveau scolaire', type: 'text' });
    baseFields.push({ name: 'birth', label: 'Date de naissance', type: 'date' });
  }
  if (profile.role === 'teacher') {
    baseFields.push({ name: 'subjects', label: 'Matières enseignées', type: 'text' });
    baseFields.push({ name: 'diploma', label: 'Diplômes', type: 'text' });
    baseFields.push({ name: 'bio', label: 'Bio', type: 'textarea' });
    baseFields.push({ name: 'price_per_hour', label: "Prix à l'heure (€)", type: 'number', step: 1, min: 0 });
  }

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) setAvatarFile(f);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile((p) => ({ ...p, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!profile.uid) return;
    setSaving(true);
    try {
      let avatarUrl = profile.avatarUrl || '';
      if (avatarFile) {
        const path = `avatars/${profile.uid}`;
        const r = sRef(storage, path);
        await uploadBytes(r, avatarFile);
        avatarUrl = await getDownloadURL(r);
      }

      const ref = doc(db, 'users', profile.uid);
      const toSave = { ...profile, avatarUrl };
      delete toSave.uid; // ne pas écraser l'uid dans le doc

      await updateDoc(ref, toSave);
      setProfile((p) => ({ ...p, avatarUrl }));
      alert('Profil mis à jour !');
    } catch (err) {
      console.error(err);
      alert("Erreur pendant l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = '/';
  };

  const handleResetPassword = async () => {
    const email = profile.email || auth.currentUser?.email;
    if (!email) return alert("Pas d'adresse email trouvée.");
    await sendPasswordResetEmail(auth, email);
    alert('Un email de réinitialisation a été envoyé.');
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible.')) return;
    if (!profile.uid) return;
    setSaving(true);
    try {
      // supprimer avatar si présent
      if (profile.avatarUrl) {
        try {
          const r = sRef(storage, `avatars/${profile.uid}`);
          await deleteObject(r);
        } catch {}
      }
      // supprimer doc Firestore
      await deleteDoc(doc(db, 'users', profile.uid));
      // supprimer utilisateur
      await deleteUser(auth.currentUser);
      alert('Compte supprimé. À bientôt !');
      window.location.href = '/';
    } catch (error) {
      if (String(error?.code || '').includes('requires-recent-login')) {
        alert("Pour des raisons de sécurité, reconnecte-toi puis réessaie la suppression.");
      } else {
        alert('Erreur lors de la suppression : ' + error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  // ------- actions Stripe (onboarding / update) -------
  const handleStripeOnboarding = async (mode = 'onboarding') => {
    try {
      const data = await fetchWithAuth(
        mode === 'update' ? '/api/connect-link?mode=update' : '/api/connect-link',
        { method: 'POST' }
      );
      // redirige vers le flow Stripe (saisie IBAN, KYC…)
      window.location.href = data.url;
    } catch (e) {
      console.error(e);
      alert("Impossible d'ouvrir la page de configuration des paiements.");
    }
  };

  if (!userLoaded) {
    return (
      <DashboardLayout role={profile.role || 'student'}>
        <div className="min-h-[40vh] flex items-center justify-center text-gray-500">
          Chargement…
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={profile.role || 'student'}>
      <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-lg p-8 border border-gray-100 mt-6">
        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden mb-3 shadow border-2 border-primary">
            <img
              src={profile.avatarUrl || '/avatar-default.png'}
              alt="Photo de profil"
              className="w-full h-full object-cover"
            />
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            className="block text-xs mb-1"
          />
        </div>

        <h2 className="text-2xl font-bold text-primary mb-4 text-center">Mon Profil</h2>

        <form className="space-y-4" onSubmit={handleSave}>
          {baseFields.map((f) => (
            <div key={f.name}>
              <label className="block mb-1 text-sm font-medium text-gray-700">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  name={f.name}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile[f.name] || ''}
                  onChange={handleChange}
                  rows={3}
                />
              ) : (
                <input
                  type={f.type}
                  name={f.name}
                  step={f.step}
                  min={f.min}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile[f.name] || ''}
                  onChange={handleChange}
                  required={f.required}
                />
              )}
            </div>
          ))}

          {/* Dispos prof */}
          {profile.role === 'teacher' && (
            <TeacherAvailabilityEditor
              value={profile.availability || {}}
              onChange={(avail) => setProfile((p) => ({ ...p, availability: avail }))}
            />
          )}

          <button
            type="submit"
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={saving}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        {/* -------- Carte Paiements (Stripe) pour PROF -------- */}
        {profile.role === 'teacher' && (
          <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-primary mb-2">Paiements & RIB (via Stripe)</h3>
            <p className="text-sm text-gray-600 mb-3">
              Configure tes informations (identité, IBAN). C’est Stripe qui les stocke et vérifie — rien n’est conservé chez EduKaraib.
            </p>

            <PaymentStatusCard />

            <div className="flex flex-wrap gap-2 mt-4">
              {!profile.stripeAccountId ? (
                <button
                  onClick={() => handleStripeOnboarding('onboarding')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-semibold"
                >
                  Configurer mes paiements
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleStripeOnboarding('onboarding')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-semibold"
                  >
                    Ouvrir mon portail Stripe
                  </button>
                  <button
                    onClick={() => handleStripeOnboarding('update')}
                    className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded font-semibold"
                  >
                    Mettre à jour mon RIB
                  </button>
                </>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Anti-fraude & conformité : KYC/AML par Stripe, 3DS, vérification IBAN. Les virements sont déclenchés automatiquement vers ton compte.
            </p>
          </div>
        )}

        {/* Actions compte */}
        <div className="mt-8 flex flex-col gap-2">
          <button
            onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300 transition"
          >
            Se déconnecter
          </button>
          <button
            onClick={handleResetPassword}
            className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200 transition"
          >
            Changer de mot de passe
          </button>
          <button
            onClick={handleDeleteAccount}
            className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200 transition"
            disabled={saving}
          >
            Supprimer mon compte
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}