import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db, storage } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import TeacherAvailabilityEditor from '../components/TeacherAvailabilityEditor';
import PaymentStatusCard from '../components/stripe/PaymentStatusCard';
import StripeConnectButtons from '../components/stripe/StripeConnectButtons';

/* ====== Contrôles de saisie (alignés avec Register) ====== */
// Communes officielles de Guyane (22)
const GUYANE_COMMUNES = [
  'Apatou',
  'Awala-Yalimapo',
  'Camopi',
  'Cayenne',
  'Grand-Santi',
  'Iracoubo',
  'Kourou',
  'Macouria',
  'Mana',
  'Maripasoula',
  'Matoury',
  'Montsinéry-Tonnegrande',
  'Ouanary',
  'Papaïchton',
  'Régina',
  'Rémire-Montjoly',
  'Roura',
  'Saint-Élie',
  'Saint-Georges',
  'Saint-Laurent-du-Maroni',
  'Saül',
  'Sinnamary',
];
const NAME_CHARS_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]*$/;  // saisie incrémentale
const NAME_MIN2_REGEX  = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/; // contrôle final (≥2)
const PHONE_REGEX = /^[+0-9 ()-]{7,20}$/;

const normalize = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const existsCity = (city) => {
  const n = normalize(city);
  return GUYANE_COMMUNES.some((c) => normalize(c) === n);
};

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

    // paramètres cours de groupe
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

  // Champs dynamiques (UI)
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

  // ✅ Contrôles au fil de la frappe (similaires à Register)
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    // Nom complet : autoriser lettres/espaces/-/’ uniquement
    if (name === 'fullName') {
      if (NAME_CHARS_REGEX.test(value)) {
        setProfile((p) => ({ ...p, fullName: value }));
      }
      return;
    }

    // Téléphone : contraindre aux caractères autorisés
    if (name === 'phone') {
      if (/^[+0-9 ()-]*$/.test(value)) {
        setProfile((p) => ({ ...p, phone: value }));
      }
      return;
    }

    // Ville : laisser taper tout, on validera à l'enregistrement
    if (name === 'city') {
      setProfile((p) => ({ ...p, city: value }));
      return;
    }

    // price_per_hour / group_capacity : laisser faire l'input number (coercion au submit)
    if (name === 'price_per_hour' || name === 'group_capacity') {
      setProfile((p) => ({ ...p, [name]: value }));
      return;
    }

    setProfile((p) => ({
      ...p,
      [name]: type === 'checkbox' ? !!checked : value,
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!profile.uid) return;

    // ✅ Validations finales (anti-fausses valeurs)
    if (!NAME_MIN2_REGEX.test(profile.fullName || '')) {
      return alert('Nom complet invalide (2 caractères minimum, lettres/espaces/-/’).');
    }
    if (profile.phone && !PHONE_REGEX.test(profile.phone)) {
      return alert('Numéro de téléphone invalide.');
    }
    if (profile.city && !existsCity(profile.city)) {
      return alert('Ville inconnue : indique une commune de Guyane (liste officielle).');
    }

    // Prix et capacité : nombres sûrs
    const priceNum =
      profile.price_per_hour === '' || profile.price_per_hour === null
        ? null
        : Number(profile.price_per_hour);
    const capacityNum =
      profile.group_capacity === '' || profile.group_capacity === null
        ? 1
        : Number(profile.group_capacity);

    if (priceNum !== null && (Number.isNaN(priceNum) || priceNum < 0)) {
      return alert("Le prix à l'heure doit être un nombre ≥ 0.");
    }
    if (Number.isNaN(capacityNum) || capacityNum < 1) {
      return alert('La capacité de groupe doit être un entier ≥ 1.');
    }

    setSaving(true);
    try {
      // Upload avatar si présent
      let avatarUrl = profile.avatarUrl || '';
      if (avatarFile) {
        const path = `avatars/${profile.uid}`;
        const r = sRef(storage, path);
        await uploadBytes(r, avatarFile);
        avatarUrl = await getDownloadURL(r);
      }

      const ref = doc(db, 'users', profile.uid);

      const toSave = {
        ...profile,
        avatarUrl,
        price_per_hour: priceNum === null || Number.isNaN(priceNum) ? 0 : Number(priceNum),
        group_enabled: !!profile.group_enabled,
        group_capacity: Number.isNaN(capacityNum) ? 1 : Math.max(1, Math.floor(capacityNum)),
        fullName: (profile.fullName || '').trim(),
        city: (profile.city || '').trim(),
        phone: (profile.phone || '').trim(),
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

  async function callDeleteAccount() {
    const idToken = await auth.currentUser.getIdToken(/* forceRefresh */ true);
    const r = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || 'Deletion failed');
    return json;
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm(
      "Supprimer définitivement votre compte ?\n" +
      "Cette action supprimera votre profil, vos fichiers et (si prof) votre compte Stripe."
    )) return;

    try {
      await callDeleteAccount();
      alert('Compte supprimé. À bientôt !');
      window.location.href = '/';
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('requires-recent-login')) {
        // Réauthentifier
        const email = auth.currentUser?.email || '';
        const pwd = window.prompt(`Par sécurité, entrez votre mot de passe (${email}) :`);
        if (!pwd) return;
        const cred = EmailAuthProvider.credential(email, pwd);
        await reauthenticateWithCredential(auth.currentUser, cred);
        // Réessaye
        await callDeleteAccount();
        alert('Compte supprimé. À bientôt !');
        window.location.href = '/';
      } else {
        alert('Erreur de suppression : ' + msg);
      }
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

          {/* Réglage des cours de groupe pour PROF */}
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
          {/* Suppression de compte : réauthentification déjà gérée si nécessaire via reauthenticateWithCredential */}
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