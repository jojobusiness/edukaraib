import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { onAuthStateChanged, signOut, sendPasswordResetEmail, deleteUser } from 'firebase/auth';

import TeacherAvailabilityEditor from '../components/TeacherAvailabilityEditor';
import PaymentStatusCard from '../components/stripe/PaymentStatusCard';
import StripeConnectButtons from '../components/stripe/StripeConnectButtons';

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
    stripeAccountId: '',
    stripePayoutsEnabled: false,
    stripeChargesEnabled: false,
    stripeDetailsSubmitted: false,

    // 🚀 NOUVEAU : paramètres cours de groupe (déjà consommés ailleurs)
    group_enabled: false,
    group_capacity: 1,
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
            // valeurs par défaut si absentes en base
            group_enabled: typeof data.group_enabled === 'boolean' ? data.group_enabled : false,
            group_capacity: typeof data.group_capacity === 'number' ? data.group_capacity : 1,
          }));
        } else {
          setProfile((prev) => ({ ...prev, uid: u.uid, email: u.email || '' }));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setUserLoaded(true);
      }
    });
    return () => unsub();
  }, []);

  // Champs dynamiques
  const fields = [
    { name: 'fullName', label: 'Nom complet', required: true, type: 'text' },
    { name: 'phone', label: 'Téléphone', type: 'tel' },
    { name: 'city', label: 'Ville', type: 'text' },
    ...(profile.role === 'student'
      ? [
          { name: 'level', label: 'Niveau scolaire', type: 'text' },
          { name: 'birth', label: 'Date de naissance', type: 'date' },
        ]
      : []),
    ...(profile.role === 'teacher'
      ? [
          { name: 'subjects', label: 'Matières enseignées', type: 'text' },
          { name: 'diploma', label: 'Diplômes', type: 'text' },
          { name: 'bio', label: 'Bio', type: 'textarea' },
          { name: 'price_per_hour', label: "Prix à l'heure (€)", type: 'number', step: 1, min: 0 },
        ]
      : []),
  ];

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) setAvatarFile(f);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setProfile((p) => ({
      ...p,
      [name]: type === 'checkbox' ? !!checked : value,
    }));
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

      // conversions numériques sûres
      const priceNum =
        profile.price_per_hour === '' || profile.price_per_hour === null
          ? null
          : Number(profile.price_per_hour);
      const capacityNum =
        profile.group_capacity === '' || profile.group_capacity === null
          ? 1
          : Math.max(1, Number(profile.group_capacity));

      const toSave = {
        ...profile,
        avatarUrl,
        // on réécrit les champs qui doivent être num/boolean
        price_per_hour: typeof priceNum === 'number' && !Number.isNaN(priceNum) ? priceNum : 0,
        group_enabled: !!profile.group_enabled,
        group_capacity: Number.isNaN(capacityNum) ? 1 : capacityNum,
      };
      delete toSave.uid; // uid n'est pas stocké dans le doc

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
      if (profile.avatarUrl) {
        try {
          const r = sRef(storage, `avatars/${profile.uid}`);
          await deleteObject(r);
        } catch {}
      }
      await deleteDoc(doc(db, 'users', profile.uid));
      await deleteUser(auth.currentUser);
      alert('Compte supprimé. À bientôt !');
      window.location.href = '/';
    } catch (error) {
      if (String(error?.code || '').includes('requires-recent-login')) {
        alert('Pour des raisons de sécurité, reconnecte-toi puis réessaie.');
      } else {
        alert('Erreur lors de la suppression : ' + error.message);
      }
    } finally {
      setSaving(false);
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
        {/* Avatar */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden mb-3 shadow border-2 border-primary">
            <img
              src={profile.avatarUrl || '/avatar-default.png'}
              alt="Photo de profil"
              className="w-full h-full object-cover"
            />
          </div>
          <input type="file" accept="image/*" onChange={handlePhoto} className="block text-xs mb-1" />
        </div>

        <h2 className="text-2xl font-bold text-primary mb-4 text-center">Mon Profil</h2>

        {/* Form */}
        <form className="space-y-4" onSubmit={handleSave}>
          {fields.map((f) => (
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
                  value={profile[f.name] ?? ''}
                  onChange={handleChange}
                  required={f.required}
                />
              )}
            </div>
          ))}

          {/* ⚙️ Réglage des cours de groupe pour PROF */}
          {profile.role === 'teacher' && (
            <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-gray-700">
                  Activer les cours en groupe
                </label>
                <input
                  type="checkbox"
                  name="group_enabled"
                  checked={!!profile.group_enabled}
                  onChange={handleChange}
                  className="h-5 w-5"
                />
              </div>

              <div>
                <label className="block mb-1 text-sm font-semibold text-gray-700">
                  Nombre d’élèves par cours (par défaut)
                </label>
                <input
                  type="number"
                  name="group_capacity"
                  min={1}
                  step={1}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.group_capacity ?? 1}
                  onChange={handleChange}
                  disabled={!profile.group_enabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Ce nombre sera utilisé par défaut lors des réservations groupées. Il reste modifiable
                  ensuite dans “Gérer le groupe” pour chaque cours.
                </p>
              </div>
            </div>
          )}

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

        {/* Paiements (Stripe) pour PROF */}
        {profile.role === 'teacher' && (
          <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-primary mb-2">Paiements & RIB (via Stripe)</h3>
            <p className="text-sm text-gray-600 mb-3">
              Configure tes informations (identité, IBAN). Stripe les stocke/vérifie — rien n’est conservé chez EduKaraib.
            </p>

            <PaymentStatusCard />
            <StripeConnectButtons hasAccount={!!profile.stripeAccountId} />

            <p className="text-xs text-gray-500 mt-3">
              Anti-fraude : vérif. identité (KYC), IBAN, 3DS. Les virements arrivent directement sur ton compte bancaire.
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