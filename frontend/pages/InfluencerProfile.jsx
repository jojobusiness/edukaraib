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
      try {
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
      } catch (e) {
        console.error('InfluencerProfile auth error:', e);
      } finally {
        setAuthLoading(false);
      }
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
      alert('Profil mis à jour !');
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
    if (!email) return alert("Pas d'adresse email trouvée.");
    await sendPasswordResetEmail(auth, email);
    alert('Email de réinitialisation envoyé.');
  };

  // Fonction interne : appel API sans confirm ni reauth (évite la récursion infinie)
  const callDeleteAccount = async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('Not signed in');
    const idToken = await u.getIdToken(true);
    const r = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Supprimer définitivement votre compte ?\nCette action est irréversible.')) return;
    try {
      await callDeleteAccount();
      alert('Compte supprimé. À bientôt !');
      window.location.href = '/';
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('requires-recent-login')) {
        const email = auth.currentUser?.email || '';
        const pwd = window.prompt('Par sécurité, entrez votre mot de passe (' + email + ') :');
        if (!pwd) return;
        const cred = EmailAuthProvider.credential(email, pwd);
        await reauthenticateWithCredential(auth.currentUser, cred);
        // Appel direct sans re-confirm ni récursion
        try {
          await callDeleteAccount();
          alert('Compte supprimé. À bientôt !');
          window.location.href = '/';
        } catch (err2) {
          alert('Erreur : ' + String(err2?.message || err2));
        }
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
              <label className="block mb-1 text-sm font-medium text-gray-700">Prénom</label>
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
            <label className="block mb-1 text-sm font-medium text-gray-700">Téléphone</label>
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
              <option value="">Sélectionner…</option>
              {CARAIBES_VILLES.map(c => <option key={c} value={c}>{c}</option>)}
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
            <label className="block mb-1 text-sm font-medium text-gray-700">Réseau principal</label>
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
              placeholder="ex : 5 000 abonnés" />
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
            Se déconnecter
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