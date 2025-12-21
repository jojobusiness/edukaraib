import React, { useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  reload
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import StripeConnectButtons from '../components/stripe/StripeConnectButtons';

// ————————————————————————————————
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

export default function Register() {
  const [form, setForm] = useState({
    email: '', password: '',
    firstName: '', lastName: '',
    role: 'student',
    phone: '', city: '',
    level: '', birth: '',
    subjects: '', diploma: '', bio: '',

    // Présentiel
    presentiel_enabled: true,
    price_per_hour: '',
    pack5_price: '',      // total 5h (≤ 0.9 * 5 * price_per_hour)
    pack10_price: '',     // total 10h (≤ 0.9 * 10 * price_per_hour)

    // Visio
    visio_enabled: false,
    visio_same_rate: true,
    visio_price_per_hour: '',
    visio_pack5_price: '',   // total 5h visio (≤ 0.9 * 5 * visioRate)
    visio_pack10_price: '',  // total 10h visio (≤ 0.9 * 10 * visioRate)

    // À propos
    about_me: '',
    about_course: '',
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  // CGU obligatoires
  const [acceptTerms, setAcceptTerms] = useState(false);

  // — Étape 2 : attente vérif email
  const [pendingUser, setPendingUser] = useState(null);
  const [waitingEmailVerify, setWaitingEmailVerify] = useState(false);

  // Après finalisation pour prof : Stripe
  const [afterSignupTeacher, setAfterSignupTeacher] = useState(false);

  const navigate = useNavigate();

  // ✅ Lien utilisé dans les emails Firebase (vérif email)
  const actionCodeSettings = {
    url: 'https://www.edukaraib.com/auth/action',
    handleCodeInApp: true,
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (type === 'checkbox') {
      setForm((f) => ({ ...f, [name]: !!checked }));
      return;
    }

    if (name === 'firstName' || name === 'lastName') {
      if (NAME_CHARS_REGEX.test(value)) {
        setForm((f) => ({ ...f, [name]: value }));
      }
      return;
    }
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handlePhoto = (e) => setPhoto(e.target.files?.[0] || null);

  // — Étape A : création compte + envoi email
  const startRegister = async (e) => {
    e.preventDefault();

    if (!acceptTerms) {
      return alert("Tu dois accepter les Conditions Générales d’Utilisation pour créer un compte.");
    }

    if (!NAME_MIN2_REGEX.test(form.firstName)) return alert("Prénom invalide.");
    if (!NAME_MIN2_REGEX.test(form.lastName)) return alert("Nom invalide.");
    if (!form.email) return alert("Adresse email requise.");
    if (!form.password || form.password.length < 6) return alert("Mot de passe trop court (≥6).");

    if (!form.city) return alert("Merci d’indiquer votre ville.");
    if (!existsCity(form.city)) return alert("Ville inconnue : choisissez une commune de Guyane proposée.");
    if (form.birth) {
      if (form.birth > TODAY) return alert("La date de naissance ne peut pas dépasser la date d’aujourd’hui.");
    }

    // Validations spécifiques prof
    if (form.role === 'teacher') {
      if (!form.presentiel_enabled && !form.visio_enabled) {
        return alert("Active au moins un mode d’enseignement : présentiel ou visio.");
      }

      // Présentiel
      if (form.presentiel_enabled) {
        const base = Number(form.price_per_hour || 0);
        if (Number.isNaN(base) || base < 0 || base > 1000) {
          return alert("Le prix présentiel (€/h) doit être compris entre 0 et 1000 €.");
        }
        const maxPack5 = 5 * base * 0.9;
        const maxPack10 = 10 * base * 0.9;

        if (form.pack5_price !== '') {
          const p5 = Number(form.pack5_price);
          if (Number.isNaN(p5) || p5 < 0) return alert("Pack 5h (présentiel) invalide (nombre ≥ 0).");
          if (base > 0 && p5 > maxPack5) {
            return alert(`Le pack 5h (présentiel) ne doit pas dépasser ${maxPack5.toFixed(2)} € (10% de remise max).`);
          }
        }
        if (form.pack10_price !== '') {
          const p10 = Number(form.pack10_price);
          if (Number.isNaN(p10) || p10 < 0) return alert("Pack 10h (présentiel) invalide (nombre ≥ 0).");
          if (base > 0 && p10 > maxPack10) {
            return alert(`Le pack 10h (présentiel) ne doit pas dépasser ${maxPack10.toFixed(2)} € (10% de remise max).`);
          }
        }
      }

      // Visio
      if (form.visio_enabled) {
        let visioRate = 0;
        if (form.visio_same_rate) {
          visioRate = Number(form.price_per_hour || 0);
        } else {
          visioRate = Number(form.visio_price_per_hour || 0);
          if (Number.isNaN(visioRate) || visioRate < 0 || visioRate > 1000) {
            return alert("Tarif visio invalide (0 → 1000 €).");
          }
        }

        const vmax5 = 5 * visioRate * 0.9;
        const vmax10 = 10 * visioRate * 0.9;
        if (form.visio_pack5_price !== '') {
          const v5 = Number(form.visio_pack5_price);
          if (Number.isNaN(v5) || v5 < 0) return alert("Pack 5h (visio) invalide (nombre ≥ 0).");
          if (visioRate > 0 && v5 > vmax5) {
            return alert(`Le pack 5h (visio) ne doit pas dépasser ${vmax5.toFixed(2)} € (10% de remise max).`);
          }
        }
        if (form.visio_pack10_price !== '') {
          const v10 = Number(form.visio_pack10_price);
          if (Number.isNaN(v10) || v10 < 0) return alert("Pack 10h (visio) invalide (nombre ≥ 0).");
          if (visioRate > 0 && v10 > vmax10) {
            return alert(`Le pack 10h (visio) ne doit pas dépasser ${vmax10.toFixed(2)} € (10% de remise max).`);
          }
        }
      }
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await sendEmailVerification(cred.user, actionCodeSettings);
      setPendingUser(cred.user);
      setWaitingEmailVerify(true);
    } catch (err) {
      alert('Erreur: ' + (err?.message || 'Création de compte impossible'));
    } finally {
      setLoading(false);
    }
  };

  // — Étape B : vérifier que l’email est confirmé puis finaliser (avatar + Firestore)
  const finalizeAfterVerified = async () => {
    if (!pendingUser) return;

    setLoading(true);
    try {
      await reload(pendingUser);

      if (!pendingUser.emailVerified) {
        // ✅ On laisse continuer, mais on avertit
        alert("Ton email n’est pas encore vérifié. Tu peux continuer, mais certaines actions pourront être limitées tant que tu n’as pas validé ton email.");
      }

      // Upload avatar si présent
      let avatarUrl = '';
      if (photo) {
        const storage = getStorage();
        const storageRef = ref(storage, `avatars/${pendingUser.uid}`);
        await uploadBytes(storageRef, photo);
        avatarUrl = await getDownloadURL(storageRef);
      }

      const fullName = `${form.firstName} ${form.lastName}`.trim();
      const baseData = {
        uid: pendingUser.uid,
        email: pendingUser.email,
        role: form.role,
        firstName: form.firstName,
        lastName: form.lastName,
        fullName,
        phone: form.phone || '',
        city: form.city || '',
        avatarUrl,
        createdAt: serverTimestamp(),
      };

      if (form.role === 'student') {
        Object.assign(baseData, {
          level: form.level || '',
          birth: form.birth || '',
        });
      }

      if (form.role === 'teacher') {
        // Normalisations nombres
        const price = form.presentiel_enabled && form.price_per_hour !== ''
          ? Number(form.price_per_hour) : 0;

        const pack5 = form.presentiel_enabled && form.pack5_price !== ''
          ? Number(Number(form.pack5_price).toFixed(2)) : '';

        const pack10 = form.presentiel_enabled && form.pack10_price !== ''
          ? Number(Number(form.pack10_price).toFixed(2)) : '';

        const visioRate =
          form.visio_enabled && !form.visio_same_rate && form.visio_price_per_hour !== ''
            ? Number(Number(form.visio_price_per_hour).toFixed(2))
            : (form.visio_enabled && form.visio_same_rate ? price : '');

        const visioPack5 =
          form.visio_enabled && form.visio_pack5_price !== ''
            ? Number(Number(form.visio_pack5_price).toFixed(2))
            : '';

        const visioPack10 =
          form.visio_enabled && form.visio_pack10_price !== ''
            ? Number(Number(form.visio_pack10_price).toFixed(2))
            : '';

        Object.assign(baseData, {
          subjects: form.subjects || '',
          diploma: form.diploma || '',
          bio: form.bio || '',
          about_me: form.about_me || '',
          about_course: form.about_course || '',

          // Stripe flags init
          stripeAccountId: '',
          stripePayoutsEnabled: false,
          stripeChargesEnabled: false,
          stripeDetailsSubmitted: false,

          // Groupe par défaut
          group_enabled: false,
          group_capacity: 1,

          // Modes
          presentiel_enabled: !!form.presentiel_enabled,
          price_per_hour: price,
          pack5_price: pack5,
          pack10_price: pack10,

          visio_enabled: !!form.visio_enabled,
          visio_same_rate: !!form.visio_same_rate,
          visio_price_per_hour: form.visio_enabled
            ? (form.visio_same_rate ? '' : visioRate)
            : '',
          visio_pack5_price: visioPack5,
          visio_pack10_price: visioPack10,
        });
      }
      
      await setDoc(doc(db, 'users', pendingUser.uid), baseData);

      setWaitingEmailVerify(false);

      if (form.role === 'teacher') {
        setAfterSignupTeacher(true);
      } else if (form.role === 'parent') {
        navigate('/parent/dashboard');
      } else {
        navigate('/dashboard-eleve');
      }

    } catch (err) {
      alert('Erreur: ' + (err?.message || 'Finalisation impossible'));
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!pendingUser) return;
    try {
      await sendEmailVerification(pendingUser, actionCodeSettings);
      alert("Email de vérification renvoyé. Pense à vérifier tes spams.");
    } catch (e) {
      alert("Impossible d’envoyer l’email de vérification pour le moment.");
    }
  };

  // — UI
  const effectiveVisioRate = form.visio_enabled
    ? (form.visio_same_rate ? Number(form.price_per_hour || 0) : Number(form.visio_price_per_hour || 0))
    : 0;
  const suggested5 = form.presentiel_enabled && Number(form.price_per_hour || 0) > 0
    ? (5 * Number(form.price_per_hour) * 0.9).toFixed(2) : '';
  const suggested10 = form.presentiel_enabled && Number(form.price_per_hour || 0) > 0
    ? (10 * Number(form.price_per_hour) * 0.9).toFixed(2) : '';
  const suggestedV5 = form.visio_enabled && effectiveVisioRate > 0
    ? (5 * effectiveVisioRate * 0.9).toFixed(2) : '';
  const suggestedV10 = form.visio_enabled && effectiveVisioRate > 0
    ? (10 * effectiveVisioRate * 0.9).toFixed(2) : '';

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-white via-gray-100 to-secondary/30 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex flex-col items-center mb-6">
          <img src="/edukaraib_logo.png" alt="Logo EduKaraib" className="h-14 mb-3" />
          <h2 className="text-2xl font-bold text-primary mb-1">Inscription</h2>
          <p className="text-gray-600 text-center text-sm">
            Crée ton compte gratuitement et trouve le prof qu’il te faut en Guyane !
          </p>
        </div>

        {/* Étape C (après finalisation prof) : Stripe immédiat */}
        {afterSignupTeacher ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
              <h3 className="text-lg font-bold text-primary mb-1">Activer les paiements (Stripe)</h3>
              <p className="text-sm text-gray-600 mb-3">
                Configure ton compte pour recevoir tes virements (KYC, IBAN, etc.). Ton email est vérifié ✔️
              </p>
              <StripeConnectButtons hasAccount={false} />
            </div>
            <div className="flex gap-2">
              <Link
                to="/prof/dashboard"
                className="w-full text-center bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition"
              >
                Aller au dashboard prof
              </Link>
            </div>
          </div>
        ) : waitingEmailVerify ? (
          // Étape B : écran attente vérification email
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 p-4 bg-amber-50">
              <h3 className="text-lg font-bold text-amber-800 mb-1">Vérifie ton email</h3>
              <p className="text-sm text-amber-800/90">
                Nous avons envoyé un lien de confirmation à <b>{pendingUser?.email}</b>.<br />
                Clique sur le lien, puis reviens ici et appuie sur <b>“J’ai vérifié mon email”</b> pour continuer.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={finalizeAfterVerified}
                className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
                disabled={loading}
              >
                J’ai vérifié mon email
              </button>
              <button
                onClick={resendVerification}
                type="button"
                className="w-full bg-white border border-gray-300 text-gray-800 font-semibold py-2 rounded-lg shadow hover:bg-gray-50 transition disabled:opacity-60"
                disabled={loading}
              >
                Renvoyer l’email
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Astuce : si tu ne vois rien, vérifie les dossiers <i>spams</i> / <i>promotions</i>.
            </p>
          </div>
        ) : (
          // Étape A : formulaire
          <form className="space-y-4" onSubmit={startRegister}>
            {/* Photo */}
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Photo de profil</label>
              <input type="file" accept="image/*" onChange={handlePhoto} className="w-full text-sm" />
            </div>

            {/* Prénom / Nom */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Prénom</label>
                <input
                  type="text"
                  name="firstName"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={form.firstName}
                  onChange={handleChange}
                  required
                  placeholder="ex : Sarah"
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Nom</label>
                <input
                  type="text"
                  name="lastName"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={form.lastName}
                  onChange={handleChange}
                  required
                  placeholder="ex : Dupont"
                />
              </div>
            </div>

            {/* Email / Password */}
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                name="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.email}
                onChange={handleChange}
                required
                placeholder="ton@email.com"
              />
              <p className="text-xs text-gray-500 mt-1">
                Un email de vérification te sera envoyé. Tu devras confirmer avant de continuer.
              </p>
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Mot de passe</label>
              <input
                type="password"
                name="password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.password}
                onChange={handleChange}
                required
                placeholder="6 caractères minimum"
              />
            </div>

            {/* Rôle */}
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Je suis :</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                name="role"
                value={form.role}
                onChange={handleChange}
              >
                <option value="student">Élève</option>
                <option value="parent">Parent</option>
                <option value="teacher">Professeur</option>
              </select>
            </div>

            {/* Téléphone (facultatif mais validé si saisi) */}
            {(form.role === 'parent' || form.role === 'teacher') && (
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-700">Téléphone</label>
                <input
                  type="tel"
                  name="phone"
                  pattern="0[0-9]{9}"
                  maxLength={10}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="ex : 0694xxxxxx"
                />
              </div>
            )}

            {/* Ville */}
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Ville (commune)</label>
              <select
                name="city"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.city}
                onChange={handleChange}
                required
              >
                <option value="">Sélectionner…</option>
                {GUYANE_COMMUNES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Élève */}
            {form.role === 'student' && (
              <>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Niveau scolaire</label>
                  <select
                    name="level"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={form.level}
                    onChange={handleChange}
                  >
                    <option value="">Sélectionner…</option>
                    {SCHOOL_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Date de naissance</label>
                  <input
                    type="date"
                    name="birth"
                    max={TODAY}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={form.birth}
                    onChange={handleChange}
                  />
                </div>
              </>
            )}

            {/* Prof */}
            {form.role === 'teacher' && (
              <>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Matières enseignées</label>
                  <input
                    type="text"
                    name="subjects"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="ex : Maths, Physique"
                    value={form.subjects}
                    onChange={handleChange}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Diplômes</label>
                  <input
                    type="text"
                    name="diploma"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="ex : Master Maths"
                    value={form.diploma}
                    onChange={handleChange}
                  />
                </div>

                {/* À propos */}
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">À propos de moi</label>
                  <textarea
                    name="about_me"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Parle de ton parcours, ta pédagogie, tes passions, etc."
                    value={form.about_me}
                    onChange={handleChange}
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">À propos du cours</label>
                  <textarea
                    name="about_course"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Déroulé d’un cours type, supports utilisés, suivi, devoirs, etc."
                    value={form.about_course}
                    onChange={handleChange}
                    rows={3}
                  />
                </div>

                {/* Choix des modes */}
                <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
                  <h4 className="text-md font-bold text-gray-800">Modes proposés</h4>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700">Présentiel</label>
                    <input
                      type="checkbox"
                      name="presentiel_enabled"
                      checked={!!form.presentiel_enabled}
                      onChange={handleChange}
                      className="h-5 w-5"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700">Visio</label>
                    <input
                      type="checkbox"
                      name="visio_enabled"
                      checked={!!form.visio_enabled}
                      onChange={handleChange}
                      className="h-5 w-5"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Tu peux proposer un seul mode ou les deux.</p>
                </div>

                {/* Présentiel : prix + packs */}
                {form.presentiel_enabled && (
                  <>
                    <div>
                      <label className="block mb-1 text-sm font-medium text-gray-700">Prix à l’heure (présentiel) €</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        name="price_per_hour"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        placeholder="ex : 25"
                        value={form.price_per_hour}
                        onChange={handleChange}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-700">Pack 5h (total) €</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          name="pack5_price"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          placeholder="ex : 90 si 20€/h"
                          value={form.pack5_price}
                          onChange={handleChange}
                        />
                        {Number(form.price_per_hour || 0) > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {(5 * Number(form.price_per_hour) * 0.9).toFixed(2)} €</p>
                        )}
                      </div>
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-700">Pack 10h (total) €</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          name="pack10_price"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          placeholder="ex : 180 si 20€/h"
                          value={form.pack10_price}
                          onChange={handleChange}
                        />
                        {Number(form.price_per_hour || 0) > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {(10 * Number(form.price_per_hour) * 0.9).toFixed(2)} €</p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Visio : tarif (same/diff) + packs visio */}
                {form.visio_enabled && (
                  <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="visio_same_rate"
                        checked={!!form.visio_same_rate}
                        onChange={handleChange}
                      />
                      <label className="text-sm">Même tarif horaire que le présentiel</label>
                    </div>

                    {!form.visio_same_rate && (
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-700">Tarif visio (€ / h)</label>
                        <input
                          type="number"
                          name="visio_price_per_hour"
                          min={0}
                          max={1000}
                          step="0.5"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          value={form.visio_price_per_hour}
                          onChange={handleChange}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-700">Pack 5h visio (total) €</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          name="visio_pack5_price"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          value={form.visio_pack5_price}
                          onChange={handleChange}
                        />
                        {effectiveVisioRate > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {(5 * effectiveVisioRate * 0.9).toFixed(2)} €</p>
                        )}
                      </div>
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-700">Pack 10h visio (total) €</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          name="visio_pack10_price"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                          value={form.visio_pack10_price}
                          onChange={handleChange}
                        />
                        {effectiveVisioRate > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Conseil (≤ -10%) : {(10 * effectiveVisioRate * 0.9).toFixed(2)} €</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* CGU obligatoires */}
            <div className="flex items-start gap-2 mt-2">
              <input
                id="acceptTerms"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                required
              />
              <label htmlFor="acceptTerms" className="text-sm text-gray-700">
                J’ai lu et j’accepte les{' '}
                <Link to="/cgu" className="text-primary font-semibold hover:underline">
                  Conditions Générales d’Utilisation
                </Link>.
              </label>
            </div>

            <button
              type="submit"
              className="w-full bg-primary text-white font-semibold py-2 rounded-lg shadow hover:bg-primary-dark transition disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Inscription..." : "S’inscrire"}
            </button>
          </form>
        )}

        {!afterSignupTeacher && !waitingEmailVerify && (
          <div className="mt-4 text-center text-sm text-gray-700">
            Déjà un compte ?{' '}
            <Link to="/login" className="text-primary font-semibold hover:underline">
              Se connecter
            </Link>
          </div>
        )}
        <div className="mt-3 text-center">
          <Link to="/" className="inline-block bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-200 transition">
            ⬅️ Retour à l’accueil
          </Link>
        </div>
      </div>
    </div>
  );
}