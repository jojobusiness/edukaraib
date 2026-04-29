import React, { useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  reload
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import StripeConnectButtons from '../components/stripe/StripeConnectButtons';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import fetchWithAuth from '../utils/fetchWithAuth';

// ————————————————————————————————
// Villes des Caraïbes et au-delà (pour profs en visio du monde entier)
const CARAIBES_VILLES = [
  // Guadeloupe
  'Pointe-à-Pitre','Basse-Terre','Les Abymes','Baie-Mahault','Le Gosier','Sainte-Anne','Saint-François','Le Moule','Capesterre-Belle-Eau','Pointe-Noire','Lamentin','Sainte-Rose','Petit-Bourg','Morne-à-l\'Eau','Port-Louis','Gourbeyre','Trois-Rivières','Vieux-Habitants','Bouillante','Deshaies',
  // Marie-Galante & dépendances
  'Grand-Bourg','Capesterre-de-Marie-Galante','Saint-Louis',
  // Martinique
  'Fort-de-France','Le Lamentin','Le Robert','Schoelcher','Le François','Sainte-Marie','Le Marin','La Trinité','Les Trois-Îlets','Le Vauclin','Le Diamant','Rivière-Pilote','Rivière-Salée','Sainte-Luce','Ducos','Le Carbet','Saint-Pierre','Le Prêcheur','Case-Pilote','Bellefontaine','Macouba','Basse-Pointe','Ajoupa-Bouillon','Fonds-Saint-Denis','Saint-Joseph','Gros-Morne','Lorrain','Sainte-Anne','Saint-Esprit','Le Saint-Esprit',
  // Guyane française
  'Cayenne','Kourou','Matoury','Rémire-Montjoly','Saint-Laurent-du-Maroni','Mana','Maripasoula','Macouria','Iracoubo','Sinnamary','Apatou','Grand-Santi','Papaïchton','Régina','Roura','Saint-Élie','Camopi','Awala-Yalimapo','Montsinéry-Tonnegrande','Saül','Ouanary','Saint-Georges',
  // Saint-Martin
  'Marigot','Grand-Case','Orient Bay',
  // Sint Maarten
  'Philipsburg','Simpson Bay','Cole Bay',
  // Saint-Barthélemy
  'Gustavia','Lorient','Saint-Jean','Flamands','Corossol',
  // Haïti
  'Port-au-Prince','Pétionville','Carrefour','Delmas','Tabarre','Cité Soleil','Cap-Haïtien','Gonaïves','Saint-Marc','Jacmel','Les Cayes','Jérémie','Miragoâne','Hinche',
  // République Dominicaine
  'Saint-Domingue','Santiago de los Caballeros','La Romana','San Pedro de Macorís','San Cristóbal','Puerto Plata','La Vega','Moca','Higüey','Barahona',
  // Cuba
  'La Havane','Santiago de Cuba','Holguín','Camagüey','Guantánamo','Santa Clara','Bayamo','Trinidad','Cienfuegos','Matanzas','Pinar del Río','Las Tunas',
  // Jamaïque
  'Kingston','Spanish Town','Montego Bay','Portmore','Mandeville','May Pen',
  // Trinidad-et-Tobago
  'Port of Spain','San Fernando','Chaguanas','Arima','Point Fortin','Scarborough',
  // Barbade
  'Bridgetown','Speightstown','Oistins','Bathsheba',
  // Sainte-Lucie
  'Castries','Vieux Fort','Micoud','Soufrière',
  // Saint-Vincent-et-les-Grenadines
  'Kingstown','Georgetown','Layou',
  // Grenade
  'Saint-Georges','Grenville','Gouyave',
  // Antigua-et-Barbuda
  'Saint John\'s','Codrington',
  // Saint-Christophe-et-Niévès
  'Basseterre','Charlestown',
  // Porto Rico (USA)
  'San Juan','Bayamón','Carolina','Ponce','Caguas','Mayagüez','Guaynabo','Trujillo Alto','Arecibo',
  // Îles Vierges américaines
  'Charlotte Amalie','Christiansted','Cruz Bay',
  // Îles Vierges britanniques
  'Road Town',
  // Aruba / Curaçao / Bonaire
  'Oranjestad','Sint Nicolaas','Willemstad','Kralendijk',
  // Suriname
  'Paramaribo','Lelydorp','Nieuw Nickerie',
  // Belize
  'Belize City','Belmopan','San Ignacio',
  // Bahamas
  'Nassau','Freeport',
  // Bermudes
  'Hamilton',
  // Caïmans
  'George Town',
  // Turks-et-Caïcos
  'Cockburn Town',
  // La Réunion
  'Saint-Denis','Saint-Paul','Saint-Pierre','Le Tampon','Saint-Louis','Saint-André','Saint-Benoît','La Possession','Sainte-Marie','Sainte-Suzanne','Saint-Leu','Cilaos','Salazie',
  // Mayotte
  'Mamoudzou','Koungou','Bandraboua','Dzaoudzi','Bouéni','Kani-Kéli','Chiconi','Tsingoni',
  // Polynésie française
  'Papeete','Faaa','Punaauia','Pirae','Mahina','Moorea','Bora Bora','Raiatea','Huahine',
  // Nouvelle-Calédonie
  'Nouméa','Mont-Dore','Dumbéa','Païta','Koné','Bourail',
  // Saint-Pierre-et-Miquelon
  'Saint-Pierre','Miquelon',
  // Wallis-et-Futuna
  'Mata-Utu',
  // France métropolitaine & DOM-TOM (pour profs en visio)
  'Paris','Lyon','Marseille','Bordeaux','Toulouse','Nantes','Strasbourg','Montpellier','Nice','Rennes','Lille','Reims','Saint-Étienne','Le Havre','Toulon','Grenoble','Dijon','Angers','Nîmes','Clermont-Ferrand',
  // International
  'En ligne',
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
  if (!city || !city.trim()) return false;
  const n = normalize(city);
  return CARAIBES_VILLES.some((c) => normalize(c) === n);
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
    teaching_levels: [],

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

    // Parrainage (optionnel, profs uniquement)
    referralCode: '',
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  // CGU obligatoires
  const [acceptTerms, setAcceptTerms] = useState(false);

  // — Étape 2 : attente vérif email
  const [pendingUser, setPendingUser] = useState(null);
  const [waitingEmailVerify, setWaitingEmailVerify] = useState(false);

  // Après finalisation pour prof : Stripe
  const [afterSignupTeacher, setAfterSignupTeacher] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Code parrain student transmis via ?ref=REF-XXXXXX
  const refCodeFromUrl = searchParams.get('ref') || '';

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
    if (form.password !== confirmPassword) return alert("Les mots de passe ne correspondent pas.");

    if (!form.city) return alert("Merci d’indiquer votre ville.");
    if (!existsCity(form.city)) return alert("Ville inconnue : choisissez une ville proposée dans la liste, ou sélectionnez 'En ligne'.");
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
        // Validation basique uniquement (nombre ≥ 0)
        if (form.pack5_price !== '') {
          const p5 = Number(form.pack5_price);
          if (Number.isNaN(p5) || p5 < 0) return alert("Pack 5h (présentiel) invalide (nombre ≥ 0).");
        }
        if (form.pack10_price !== '') {
          const p10 = Number(form.pack10_price);
          if (Number.isNaN(p10) || p10 < 0) return alert("Pack 10h (présentiel) invalide (nombre ≥ 0).");
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

        // Validation basique uniquement (nombre ≥ 0)
        if (form.visio_pack5_price !== '') {
          const v5 = Number(form.visio_pack5_price);
          if (Number.isNaN(v5) || v5 < 0) return alert("Pack 5h (visio) invalide (nombre ≥ 0).");
        }
        if (form.visio_pack10_price !== '') {
          const v10 = Number(form.visio_pack10_price);
          if (Number.isNaN(v10) || v10 < 0) return alert("Pack 10h (visio) invalide (nombre ≥ 0).");
        }
      }
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      // Envoi de l'email de vérification en arrière-plan (silencieux)
      sendEmailVerification(cred.user, actionCodeSettings).catch(() => {});
      setPendingUser(cred.user);
      // On finalise directement sans bloquer sur la vérification email
      await finalizeWithUser(cred.user);
    } catch (err) {
      alert('Erreur: ' + (err?.message || 'Création de compte impossible'));
    } finally {
      setLoading(false);
    }
  };

  // — Finalisation du compte (avatar + Firestore)
  const finalizeWithUser = async (userOverride) => {
    const activeUser = userOverride || pendingUser;
    if (!activeUser) return;
    // On stocke dans une variable locale stable — le state React peut être null en async
    if (userOverride) setPendingUser(userOverride);

    setLoading(true);
    try {
      // Upload avatar si présent
      let avatarUrl = '';
      if (photo) {
        const storage = getStorage();
        const storageRef = ref(storage, `avatars/${activeUser.uid}`);
        await uploadBytes(storageRef, photo);
        avatarUrl = await getDownloadURL(storageRef);
      }

      const fullName = `${form.firstName} ${form.lastName}`.trim();
      const baseData = {
        uid: activeUser.uid,
        email: activeUser.email,
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
          teaching_levels: form.teaching_levels || [],
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
      
      await setDoc(doc(db, 'users', activeUser.uid), baseData);

      // 🎟️ Coupon de bienvenue -5€ uniquement pour parents et élèves
      // fetch simple (pas de token requis), sans await pour ne pas bloquer la navigation
      if (form.role === 'parent' || form.role === 'student') {
        fetch('/api/create-welcome-coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: activeUser.uid,
            email: activeUser.email,
            fullName,
          }),
        }).catch(e => console.warn('[coupon-bienvenue] échec:', e?.message));
      }

      setWaitingEmailVerify(false);

      if (form.role === 'teacher') {
        // Générer le code parrain unique pour ce nouveau prof
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let suffix = '';
        for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
        const myReferralCode = 'PARRAIN-' + suffix;
        await setDoc(doc(db, 'users', activeUser.uid), { referralCode: myReferralCode }, { merge: true });

        // Email de bienvenue (tous les profs, avec ou sans parrain)
        fetch('/api/send-welcome-teacher', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: activeUser.email,
            firstName: form.firstName,
            referralCode: myReferralCode,
          }),
        }).catch(e => console.warn('[send-welcome-teacher] échec:', e?.message));

        // Appliquer le code parrain saisi si présent
        if (form.referralCode?.trim()) {
          fetch('/api/apply-referral', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              referralCode: form.referralCode.trim().toUpperCase(),
              newTeacherUid: activeUser.uid,
              newTeacherEmail: activeUser.email,
              newTeacherName: fullName,
            }),
          }).catch(e => console.warn('[apply-referral] échec:', e?.message));
        }

        setAfterSignupTeacher(true);
      } else if (form.role === 'parent' || form.role === 'student') {
        // Générer un code de parrainage étudiant unique
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let suffix = '';
        for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
        const studentReferralCode = 'REF-' + suffix;
        await setDoc(doc(db, 'users', activeUser.uid), { studentReferralCode }, { merge: true });

        // Appliquer le code parrain reçu en URL si présent
        const refCode = (refCodeFromUrl || '').trim().toUpperCase();
        if (refCode.startsWith('REF-')) {
          fetch('/api/apply-student-referral', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              referralCode: refCode,
              newUserUid: activeUser.uid,
              newUserEmail: activeUser.email,
              newUserName: fullName,
            }),
          }).catch(e => console.warn('[apply-student-referral] échec:', e?.message));
        }

        if (form.role === 'parent') {
          navigate('/parent/dashboard');
        } else {
          navigate('/dashboard-eleve');
        }
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
            Crée ton compte gratuitement et trouve le prof qu’il te faut en au Caraïbe !
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
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10"
                  value={form.password}
                  onChange={handleChange}
                  required
                  placeholder="6 caractères minimum"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showPassword ? "Masquer" : "Voir"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">Confirmer le mot de passe</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className={`w-full border rounded-lg px-3 py-2 pr-10 ${
                    confirmPassword && confirmPassword !== form.password
                      ? 'border-red-400 focus:ring-red-300'
                      : confirmPassword && confirmPassword === form.password
                      ? 'border-green-400 focus:ring-green-300'
                      : 'border-gray-300'
                  }`}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Répéter le mot de passe"
                />
                {confirmPassword && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                    {confirmPassword === form.password ? '✅' : '❌'}
                  </span>
                )}
              </div>
              {confirmPassword && confirmPassword !== form.password && (
                <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas.</p>
              )}
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
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Téléphone
                </label>

                <PhoneInput
                  international
                  defaultCountry="GF"
                  value={form.phone}
                  onChange={(value) => setForm((f) => ({ ...f, phone: value || '' }))}
                />

                <p className="text-xs text-gray-500 mt-1">
                  Exemple : +594..., +33..., +225...
                </p>
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
                {CARAIBES_VILLES.map((c) => (
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
                  <label className="block mb-1 text-sm font-medium text-gray-700">Niveaux enseignés</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {['Primaire', 'Collège', 'Lycée', 'Supérieur', 'Adulte'].map((lvl) => {
                      const selected = (form.teaching_levels || []).includes(lvl);
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => {
                            const current = form.teaching_levels || [];
                            setForm(f => ({
                              ...f,
                              teaching_levels: selected
                                ? current.filter(l => l !== lvl)
                                : [...current, lvl],
                            }));
                          }}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                            selected
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-primary'
                          }`}
                        >
                          {lvl}
                        </button>
                      );
                    })}
                  </div>
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

            {/* Code parrain (optionnel, profs uniquement) */}
            {form.role === 'teacher' && (
              <div className="rounded-xl border border-dashed border-green-300 bg-green-50 p-4">
                <label className="block mb-1 text-sm font-semibold text-green-800">🤝 Code de parrainage <span className="font-normal text-green-700">(optionnel)</span></label>
                <p className="text-xs text-green-700 mb-2">Un collègue vous a invité ? Saisissez son code et recevez <strong>20 € de prime</strong> sur votre premier pack 5h vendu.</p>
                <input
                  type="text"
                  name="referralCode"
                  className="w-full border border-green-300 rounded-lg px-3 py-2 text-sm uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal"
                  value={form.referralCode}
                  onChange={handleChange}
                  placeholder="ex : PARRAIN-AB3XY2"
                  maxLength={15}
                />
              </div>
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