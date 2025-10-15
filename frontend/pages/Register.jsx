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

const SCHOOL_LEVELS = [
  'CP','CE1','CE2','CM1','CM2',
  '6e','5e','4e','3e',
  'Seconde','Première','Terminale',
  'BTS 1','BTS 2','BUT 1','BUT 2','BUT 3',
  'CPGE 1','CPGE 2','Licence 1','Licence 2','Licence 3',
  'Master 1','Master 2','Doctorat',
  'Formation professionnelle','Remise à niveau','Autre',
];

const NAME_CHARS_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]*$/; // autorise saisie incrémentale
const NAME_MIN2_REGEX  = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,}$/; // contrôle final (≥2)
const PHONE_REGEX = /^[+0-9 ()-]{7,20}$/;

// Utils pour comparer sans accents / casse
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

export default function Register() {
  const [form, setForm] = useState({
    email: '', password: '',
    firstName: '', lastName: '',
    role: 'student',
    phone: '', city: '',
    level: '', birth: '',
    subjects: '', diploma: '', bio: '', price_per_hour: '',
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);

  // — Étape 2 : attente vérif email
  const [pendingUser, setPendingUser] = useState(null);
  const [waitingEmailVerify, setWaitingEmailVerify] = useState(false);

  // Après finalisation pour prof : Stripe
  const [afterSignupTeacher, setAfterSignupTeacher] = useState(false);

  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'firstName' || name === 'lastName') {
      // ✅ autorise la frappe lettre par lettre, bloque chiffres/symboles
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

    // ✅ validation finale (≥2 caractères)
    if (!NAME_MIN2_REGEX.test(form.firstName)) return alert("Prénom invalide.");
    if (!NAME_MIN2_REGEX.test(form.lastName)) return alert("Nom invalide.");
    if (!form.email) return alert("Adresse email requise.");
    if (!form.password || form.password.length < 6) return alert("Mot de passe trop court (≥6).");
    if (form.phone && !PHONE_REGEX.test(form.phone)) return alert("Numéro de téléphone invalide.");
    if (!form.city) return alert("Merci d’indiquer votre ville.");
    if (!existsCity(form.city)) return alert("Ville inconnue : choisissez une commune de Guyane proposée.");

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await sendEmailVerification(cred.user);
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
        setLoading(false);
        return alert("Ton email n’est pas encore vérifié. Clique le lien dans le mail, puis réessaie.");
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
        Object.assign(baseData, {
          subjects: form.subjects || '',
          diploma: form.diploma || '',
          bio: form.bio || '',
          price_per_hour: form.price_per_hour ? Number(form.price_per_hour) : 0,
          stripeAccountId: '',
          stripePayoutsEnabled: false,
          stripeChargesEnabled: false,
          stripeDetailsSubmitted: false,
          group_enabled: false,
          group_capacity: 1,
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
      await sendEmailVerification(pendingUser);
      alert("Email de vérification renvoyé. Pense à vérifier tes spams.");
    } catch (e) {
      alert("Impossible d’envoyer l’email de vérification pour le moment.");
    }
  };

  // — UI
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="ex : +594 694 xx xx xx"
                />
              </div>
            )}

            {/* Ville : input + datalist + validation d’existence */}
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Ville (commune)</label>
              <input
                list="guyane-communes"
                name="city"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={form.city}
                onChange={handleChange}
                placeholder="Commence à taper puis choisis…"
                required
              />
              <datalist id="guyane-communes">
                {GUYANE_COMMUNES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="text-xs mt-1">
                Doit correspondre à une commune de Guyane (liste proposée).
              </p>
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
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Courte bio</label>
                  <textarea
                    name="bio"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Présentez-vous en quelques mots..."
                    value={form.bio}
                    onChange={handleChange}
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-700">Prix à l’heure (€)</label>
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
              </>
            )}

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