import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { doc, getDoc, updateDoc, collection, getDocs, where, query, deleteField } from 'firebase/firestore';
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
import { auth, db, storage } from '../lib/firebase';

/* ====== Contrôles & listes (alignés avec Register) ====== */
// Communes officielles de Guyane (22)
const GUYANE_COMMUNES = [
  'Apatou','Awala-Yalimapo','Camopi','Cayenne','Grand-Santi','Iracoubo','Kourou','Macouria','Mana','Maripasoula','Matoury','Montsinéry-Tonnegrande','Ouanary','Papaïchton','Régina','Rémire-Montjoly','Roura','Saint-Élie','Saint-Georges','Saint-Laurent-du-Maroni','Saül','Sinnamary',
];

const SCHOOL_LEVELS = [
  'CP','CE1','CE2','CM1','CM2',
  '6e','5e','4e','3e',
  'Seconde','Première','Terminale',
  'BTS 1','BTS 2','BUT 1','BUT 2','BUT 3',
  'CPGE 1','CPGE 2','Licence 1','Licence 2','Licence 3',
  'Master 1','Master 2','Doctorat',
  'Formation professionnelle','Remise à niveau','Autre',
];

const NAME_CHARS_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]*$/;
const NAME_MIN2_REGEX  = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/;

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

const TODAY = new Date().toISOString().split('T')[0];

export default function Profile() {
  const [userLoaded, setUserLoaded] = useState(false);
  const [showAvailDrawer, setShowAvailDrawer] = useState(false);
  const [profile, setProfile] = useState({
    uid: '',
    email: '',
    role: '',
    firstName: '',
    lastName: '',
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

    // cours de groupe
    group_enabled: false,
    group_capacity: 1,

    // Packs présentiel
    pack5_price: '',
    pack10_price: '',

    // Modes (NOUVEAU)
    presentiel_enabled: true,   // ← choix explicite présentiel
    visio_enabled: false,       // ← déjà présent mais on garde
    visio_same_rate: true,
    visio_price_per_hour: '',

    // Packs visio (NOUVEAU)
    visio_pack5_price: '',
    visio_pack10_price: '',

    // À propos (NOUVEAU)
    about_me: '',
    about_course: '',
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
          const loadedFirst = data.firstName || (data.fullName ? data.fullName.split(' ')[0] : '');
          const loadedLast  = data.lastName  || (data.fullName ? data.fullName.split(' ').slice(1).join(' ') : '');
          setProfile((prev) => ({
            ...prev,
            ...data,
            uid: u.uid,
            email: data.email || u.email || '',
            role: data.role || data.type || prev.role || 'student',
            firstName: loadedFirst,
            lastName: loadedLast,
            group_enabled: typeof data.group_enabled === 'boolean' ? data.group_enabled : false,
            group_capacity: typeof data.group_capacity === 'number' ? data.group_capacity : 1,

            // valeurs par défaut si absentes
            pack5_price: data.pack5_price ?? '',
            pack10_price: data.pack10_price ?? '',

            // modes
            presentiel_enabled: data.presentiel_enabled !== false, // défaut true
            visio_enabled: !!data.visio_enabled,
            visio_same_rate: data.visio_same_rate !== false, // défaut true
            visio_price_per_hour: data.visio_price_per_hour ?? '',

            // packs visio
            visio_pack5_price: data.visio_pack5_price ?? '',
            visio_pack10_price: data.visio_pack10_price ?? '',

            // about
            about_me: data.about_me ?? '',
            about_course: data.about_course ?? '',
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

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) setAvatarFile(f);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name === 'firstName' || name === 'lastName') {
      if (NAME_CHARS_REGEX.test(value)) {
        setProfile((p) => ({ ...p, [name]: value }));
      }
      return;
    }
    if (name === 'phone') {
      if (/^[+0-9 ()-]*$/.test(value)) {
        setProfile((p) => ({ ...p, phone: value }));
      }
      return;
    }

    if ([
      'price_per_hour','group_capacity','pack5_price','pack10_price',
      'visio_price_per_hour','visio_pack5_price','visio_pack10_price'
    ].includes(name)) {
      setProfile((p) => ({ ...p, [name]: value }));
      return;
    }

    setProfile((p) => ({
      ...p,
      [name]: type === 'checkbox' ? !!checked : value,
    }));
  };

  // Helper : compter les participants actifs
  function isLessonEmpty(lesson = {}) {
    const hasStudentId = !!lesson.student_id;

    const ids = Array.isArray(lesson.participant_ids) ? lesson.participant_ids : [];
    const pm = lesson.participantsMap || {};

    const hasAnyParticipant =
      ids.length > 0 || (pm && typeof pm === 'object' && Object.keys(pm).length > 0);

    return !hasStudentId && !hasAnyParticipant;
  }

  function isFutureLesson(lesson = {}) {
    try {
      if (!lesson.startAt) return true;
      const d = typeof lesson.startAt.toDate === 'function'
        ? lesson.startAt.toDate()
        : new Date(lesson.startAt);
      return d.getTime() >= Date.now();
    } catch {
      return true;
    }
  }

  // Met à jour en toute sécurité les cours (ne touche pas ceux avec des participants)
  async function safelyApplyGroupSettings(teacherId, wantGroup, capacity) {
    try {
      const cap = Math.max(1, Number(capacity || 1));
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', teacherId));
      const snap = await getDocs(qLessons);

      const updates = [];
      for (const d of snap.docs) {
        const l = d.data();

        // ✅ ne toucher QUE les cours vraiment vides
        if (!isLessonEmpty(l)) continue;

        // ✅ éviter de modifier l’historique
        if (!isFutureLesson(l)) continue;

        const ref = doc(db, 'lessons', d.id);
        const patch = {
          is_group: !!wantGroup,
          capacity: wantGroup ? cap : 1,
          is_pack: deleteField(),
          pack_hours: deleteField(),
          pack_type: deleteField(),
          pack_mode: deleteField(),
        };
        updates.push(updateDoc(ref, patch));
      }

      if (updates.length) await Promise.allSettled(updates);
      console.log('Cours vides mis à jour :', updates.length);
    } catch (err) {
      console.error('Erreur mise à jour leçons', err);
    }
  }

  const handleSave = async (e) => {
    e.preventDefault();
    if (!profile.uid) return;

    // Validations de base
    if (!NAME_MIN2_REGEX.test(profile.firstName || '')) {
      return alert('Prénom invalide (2 caractères minimum).');
    }
    if (!NAME_MIN2_REGEX.test(profile.lastName || '')) {
      return alert('Nom invalide (2 caractères minimum).');
    }
    if (profile.phone) {
      const phoneClean = profile.phone.replace(/\D/g, '');
      if (!/^0[1-9]\d{8}$/.test(phoneClean)) {
        return alert("Le numéro doit commencer par 0 et contenir 10 chiffres.");
      }
    }
    if (profile.city && !existsCity(profile.city)) {
      return alert('Ville inconnue : indique une commune de Guyane.');
    }
    if (profile.birth && profile.birth > TODAY) {
      return alert("La date de naissance ne peut pas dépasser aujourd’hui.");
    }

    // Prix / Capacité
    const priceNum =
      profile.price_per_hour === '' || profile.price_per_hour === null
        ? null : Number(profile.price_per_hour);
    const capacityNum =
      profile.group_capacity === '' || profile.group_capacity === null
        ? 1 : Number(profile.group_capacity);

    if (profile.role === 'teacher') {
      // Au moins un mode actif
      if (!profile.presentiel_enabled && !profile.visio_enabled) {
        return alert("Active au moins un mode d’enseignement : présentiel ou visio.");
      }
      if (profile.presentiel_enabled) {
        if (priceNum === null || Number.isNaN(priceNum) || priceNum < 0 || priceNum > 1000) {
          return alert("Le prix présentiel (€/h) doit être entre 0 et 1000.");
        }
      }
      if (Number.isNaN(capacityNum) || capacityNum < 1) {
        return alert('La capacité de groupe doit être un entier ≥ 1.');
      }
    }

    // Packs présentiel (≤ -10%)
    const p = Number.isFinite(priceNum) ? priceNum : 0;
    const maxPack5 = 5 * p * 0.9;
    const maxPack10 = 10 * p * 0.9;

    const pack5 = profile.pack5_price === '' ? '' : Number(profile.pack5_price);
    const pack10 = profile.pack10_price === '' ? '' : Number(profile.pack10_price);

    if (profile.presentiel_enabled) {
      if (pack5 !== '' && (Number.isNaN(pack5) || pack5 < 0)) {
        return alert('Pack 5h (présentiel) invalide (nombre ≥ 0).');
      }
      if (pack10 !== '' && (Number.isNaN(pack10) || pack10 < 0)) {
        return alert('Pack 10h (présentiel) invalide (nombre ≥ 0).');
      }
      if (p > 0) {
        if (pack5 !== '' && pack5 > maxPack5) {
          return alert(`Le pack 5h (présentiel) ne doit pas dépasser ${maxPack5.toFixed(2)} € (10% de remise max).`);
        }
        if (pack10 !== '' && pack10 > maxPack10) {
          return alert(`Le pack 10h (présentiel) ne doit pas dépasser ${maxPack10.toFixed(2)} € (10% de remise max).`);
        }
      }
    }

    // Visio : tarif + packs visio (≤ -10% du tarif visio utilisé)
    let visioRateNum = null;
    if (profile.visio_enabled) {
      if (!profile.visio_same_rate) {
        visioRateNum = profile.visio_price_per_hour === '' ? null : Number(profile.visio_price_per_hour);
        if (visioRateNum === null || Number.isNaN(visioRateNum) || visioRateNum < 0 || visioRateNum > 1000) {
          return alert("Tarif visio invalide (0 → 1000 €).");
        }
      } else {
        visioRateNum = p || 0; // même tarif que présentiel
      }

      const v5 = profile.visio_pack5_price === '' ? '' : Number(profile.visio_pack5_price);
      const v10 = profile.visio_pack10_price === '' ? '' : Number(profile.visio_pack10_price);

      if (v5 !== '' && (Number.isNaN(v5) || v5 < 0)) {
        return alert('Pack 5h (visio) invalide (nombre ≥ 0).');
      }
      if (v10 !== '' && (Number.isNaN(v10) || v10 < 0)) {
        return alert('Pack 10h (visio) invalide (nombre ≥ 0).');
      }
      const vmax5 = 5 * (visioRateNum || 0) * 0.9;
      const vmax10 = 10 * (visioRateNum || 0) * 0.9;
      if (visioRateNum > 0) {
        if (v5 !== '' && v5 > vmax5) {
          return alert(`Le pack 5h (visio) ne doit pas dépasser ${vmax5.toFixed(2)} € (10% de remise max).`);
        }
        if (v10 !== '' && v10 > vmax10) {
          return alert(`Le pack 10h (visio) ne doit pas dépasser ${vmax10.toFixed(2)} € (10% de remise max).`);
        }
      }
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
      const fullName = `${(profile.firstName || '').trim()} ${(profile.lastName || '').trim()}`.trim();

      const toSave = {
        ...profile,
        fullName,
        avatarUrl,
        // normalisations
        price_per_hour: profile.presentiel_enabled
          ? (priceNum === null || Number.isNaN(priceNum) ? 0 : Number(priceNum))
          : 0,
        group_enabled: !!profile.group_enabled,
        group_capacity: Number.isNaN(capacityNum) ? 1 : Math.max(1, Math.floor(capacityNum)),
        firstName: (profile.firstName || '').trim(),
        lastName: (profile.lastName || '').trim(),
        city: (profile.city || '').trim(),
        phone: (profile.phone || '').trim(),

        // modes
        presentiel_enabled: !!profile.presentiel_enabled,
        visio_enabled: !!profile.visio_enabled,
        visio_same_rate: !!profile.visio_same_rate,
        visio_price_per_hour:
          profile.visio_enabled && !profile.visio_same_rate && visioRateNum !== null
            ? Number(visioRateNum.toFixed(2))
            : '',

        // packs présentiel
        pack5_price: profile.presentiel_enabled && pack5 !== '' ? Number(pack5.toFixed(2)) : '',
        pack10_price: profile.presentiel_enabled && pack10 !== '' ? Number(pack10.toFixed(2)) : '',

        // packs visio
        visio_pack5_price:
          profile.visio_enabled && profile.visio_pack5_price !== ''
            ? Number(Number(profile.visio_pack5_price).toFixed(2))
            : '',
        visio_pack10_price:
          profile.visio_enabled && profile.visio_pack10_price !== ''
            ? Number(Number(profile.visio_pack10_price).toFixed(2))
            : '',

        // about
        about_me: (profile.about_me || '').trim(),
        about_course: (profile.about_course || '').trim(),
      };
      delete toSave.uid;

      await updateDoc(ref, toSave);
      if (profile.role === 'teacher') {
        await safelyApplyGroupSettings(profile.uid, !!profile.group_enabled, profile.group_capacity);
      }
      setProfile((p) => ({ ...p, avatarUrl, fullName }));
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
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in");

    const idToken = await u.getIdToken(true);
    console.log("DELETE token starts:", idToken.slice(0, 20)); // juste pour voir que c'est pas vide

    const r = await fetch('/api/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
    return json;
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm(
      "Supprimer définitivement votre compte ?\nCette action supprimera votre profil, vos fichiers et (si prof) votre compte Stripe."
    )) return;

    try {
      await callDeleteAccount();
      alert('Compte supprimé. À bientôt !');
      window.location.href = '/';
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('requires-recent-login')) {
        const email = auth.currentUser?.email || '';
        const pwd = window.prompt(`Par sécurité, entrez votre mot de passe (${email}) :`);
        if (!pwd) return;
        const cred = EmailAuthProvider.credential(email, pwd);
        await reauthenticateWithCredential(auth.currentUser, cred);
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

  const basePrice = Number(profile.price_per_hour || 0);
  const suggested5 = profile.presentiel_enabled && basePrice > 0 ? (5 * basePrice * 0.9).toFixed(2) : '';
  const suggested10 = profile.presentiel_enabled && basePrice > 0 ? (10 * basePrice * 0.9).toFixed(2) : '';

  // suggestions packs visio
  const effectiveVisioRate = profile.visio_enabled
    ? (profile.visio_same_rate ? basePrice : Number(profile.visio_price_per_hour || 0))
    : 0;
  const suggestedV5 = effectiveVisioRate > 0 ? (5 * effectiveVisioRate * 0.9).toFixed(2) : '';
  const suggestedV10 = effectiveVisioRate > 0 ? (10 * effectiveVisioRate * 0.9).toFixed(2) : '';

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
          {/* Prénom / Nom */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Prénom</label>
              <input type="text" name="firstName" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.firstName || ''} onChange={handleChange} required placeholder="ex : Sarah" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Nom</label>
              <input type="text" name="lastName" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={profile.lastName || ''} onChange={handleChange} required placeholder="ex : Dupont" />
            </div>
          </div>

          {/* Téléphone */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Téléphone</label>
            <input type="tel" name="phone" pattern="0[1-9][0-9]{8}" maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.phone || ''} onChange={handleChange} placeholder="ex : 0694xxxxxx" />
          </div>

          {/* Ville */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Ville (commune)</label>
            <select name="city" className="w-full border border-gray-300 rounded-lg px-3 py-2"
              value={profile.city || ''} onChange={handleChange} required>
              <option value="">Sélectionner…</option>
              {GUYANE_COMMUNES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>

          {/* Étudiant */}
          {profile.role === 'student' && (
            <>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Niveau scolaire</label>
                <select name="level" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.level || ''} onChange={handleChange}>
                  <option value="">Sélectionner…</option>
                  {SCHOOL_LEVELS.map((lvl) => (<option key={lvl} value={lvl}>{lvl}</option>))}
                </select>
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Date de naissance</label>
                <input type="date" name="birth" max={TODAY}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.birth || ''} onChange={handleChange}/>
              </div>
            </>
          )}

          {/* Prof — matières/diplôme/bio/prix/modes */}
          {profile.role === 'teacher' && (
            <>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Matières enseignées</label>
                <input type="text" name="subjects" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.subjects || ''} onChange={handleChange} placeholder="ex : Maths, Physique" />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Diplômes</label>
                <input type="text" name="diploma" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.diploma || ''} onChange={handleChange} placeholder="ex : Master Maths" />
              </div>

              {/* À propos */}
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">À propos de moi</label>
                <textarea name="about_me" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.about_me || ''} onChange={handleChange} rows={4}
                  placeholder="Parle de ton parcours, ta pédagogie, tes passions, etc." />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">À propos du cours</label>
                <textarea name="about_course" className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={profile.about_course || ''} onChange={handleChange} rows={4}
                  placeholder="Déroulé d’un cours type, supports utilisés, suivi, devoirs, etc." />
              </div>

              {/* Choix des modes */}
              <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
                <h3 className="text-md font-bold text-gray-800">Modes proposés</h3>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Présentiel</label>
                  <input
                    type="checkbox"
                    name="presentiel_enabled"
                    checked={!!profile.presentiel_enabled}
                    onChange={handleChange}
                    className="h-5 w-5"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-gray-700">Visio</label>
                  <input
                    type="checkbox"
                    name="visio_enabled"
                    checked={!!profile.visio_enabled}
                    onChange={handleChange}
                    className="h-5 w-5"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Tu peux proposer un seul mode ou les deux.
                </p>
              </div>

              {/* Prix présentiel */}
              {profile.presentiel_enabled && (
                <>
                  <div>
                    <label className="block mb-1 text-sm font-medium text-gray-700">Prix à l’heure (présentiel) €</label>
                    <input type="number" name="price_per_hour" min={0} max={1000} step={1}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={profile.price_per_hour ?? ''} onChange={handleChange}/>
                    <p className="text-xs text-gray-500 mt-1">Maximum autorisé : 1000 € / h.</p>
                  </div>

                  {/* Packs présentiel */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Pack 5h (total) €</label>
                      <input type="number" name="pack5_price" min={0} step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={profile.pack5_price ?? ''} onChange={handleChange}/>
                      {basePrice > 0 && (
                        <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {suggested5} €</p>
                      )}
                    </div>
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Pack 10h (total) €</label>
                      <input type="number" name="pack10_price" min={0} step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={profile.pack10_price ?? ''} onChange={handleChange}/>
                      {basePrice > 0 && (
                        <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {suggested10} €</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Visio (tarif + packs visio) */}
              {profile.visio_enabled && (
                <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="visio_same_rate"
                      checked={!!profile.visio_same_rate}
                      onChange={handleChange}
                    />
                    <label className="text-sm">Même tarif horaire que le présentiel</label>
                  </div>

                  {!profile.visio_same_rate && (
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Tarif visio (€ / h)</label>
                      <input
                        type="number"
                        name="visio_price_per_hour"
                        min={0}
                        max={1000}
                        step="0.5"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={profile.visio_price_per_hour ?? ''}
                        onChange={handleChange}
                      />
                    </div>
                  )}

                  {/* Packs visio */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Pack 5h visio (total) €</label>
                      <input
                        type="number"
                        name="visio_pack5_price"
                        min={0}
                        step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={profile.visio_pack5_price ?? ''}
                        onChange={handleChange}
                      />
                      {effectiveVisioRate > 0 && (
                        <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {suggestedV5} €</p>
                      )}
                    </div>
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Pack 10h visio (total) €</label>
                      <input
                        type="number"
                        name="visio_pack10_price"
                        min={0}
                        step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={profile.visio_pack10_price ?? ''}
                        onChange={handleChange}
                      />
                      {effectiveVisioRate > 0 && (
                        <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {suggestedV10} €</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Paiements (Stripe) */}
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

          {/* cours de groupe */}
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
                  Utilisé par défaut lors des réservations groupées (modifiable par cours).
                </p>
              </div>
            </div>
          )}

          {/* Disponibilités */}
          {profile.role === 'teacher' && (
            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-md font-bold text-gray-800">Disponibilités hebdomadaires</h3>
                  <p className="text-xs text-gray-500">Chaque case = 1h.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAvailDrawer(true)}
                  className="inline-flex items-center gap-2 bg-primary text-white px-3 py-2 rounded-lg font-semibold shadow hover:bg-primary/90"
                >
                  Modifier
                </button>
              </div>
            </div>
          )}

          {/* Drawer disponibilités */}
          {profile.role === 'teacher' && (
            <div
              className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
                showAvailDrawer ? 'opacity-100 visible' : 'opacity-0 invisible'
              }`}
            >
              <div onClick={() => setShowAvailDrawer(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <div
                className={`relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-5xl mx-auto 
                            max-h-[90vh] overflow-hidden flex flex-col transition-all duration-300 ${
                  showAvailDrawer ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
                }`}
              >
                <div className="flex items-center justify-between px-6 py-4 border-b bg-primary/5 sticky top-0">
                  <h3 className="text-lg font-semibold text-primary">Éditer mes disponibilités</h3>
                  <button type="button" onClick={() => setShowAvailDrawer(false)}
                    className="text-gray-500 hover:text-gray-700 text-xl leading-none" aria-label="Fermer">×</button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-white">
                  <TeacherAvailabilityEditor
                    value={profile.availability || {}}
                    onChange={(avail) => setProfile((p) => ({ ...p, availability: avail }))}
                  />
                </div>
                <div className="flex justify-between items-center gap-2 border-t bg-gray-50 p-4 sticky bottom-0">
                  <p className="text-xs text-gray-500">Clique <b>Enregistrer</b> (en bas du profil) pour valider.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowAvailDrawer(false)}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 text-sm font-semibold">Fermer</button>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold shadow hover:bg-primary/90"
                      onClick={() => setShowAvailDrawer(false)}>Enregistrer</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <button type="submit"
            className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
            disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>

        {/* Actions compte */}
        <div className="mt-8 flex flex-col gap-2">
          <button onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 font-semibold py-2 rounded-lg hover:bg-gray-300 transition">
            Se déconnecter
          </button>
          <button onClick={handleResetPassword}
            className="w-full bg-yellow-100 text-yellow-800 font-semibold py-2 rounded-lg hover:bg-yellow-200 transition">
            Changer de mot de passe
          </button>
          <button onClick={handleDeleteAccount}
            className="w-full bg-red-100 text-red-800 font-semibold py-2 rounded-lg hover:bg-red-200 transition"
            disabled={saving}>
            Supprimer mon compte
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}