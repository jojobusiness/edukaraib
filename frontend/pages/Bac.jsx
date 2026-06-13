import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { auth } from '../lib/firebase';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useSEO } from '../hooks/useSEO';
import { saveCampaign, getCampaignCode } from '../lib/bacCampaign';
import {
  GraduationCap, Clock, ShieldCheck, CreditCard, Video, BadgeCheck,
  ChevronDown, ChevronUp, Star, ArrowRight, Ticket,
} from 'lucide-react';

/* ——— Réglages campagne (modifiable à la main) ——— */
const PROFS_DISPO = 12; // rareté affichée — mettre à jour manuellement

/* Dates bac 2026 (auto-switch du hero, zéro maintenance) */
const DATE_ECRITS = new Date('2026-06-15T08:00:00+02:00');
const DATE_RESULTATS = new Date('2026-07-04T10:00:00+02:00');
const DATE_RATTRAPAGE = new Date('2026-07-07T08:00:00+02:00');
const FIN_RATTRAPAGE = new Date('2026-07-11T00:00:00+02:00');

const SUBJECTS_BAC = [
  'Maths', 'Français', 'Philosophie', 'Physique-Chimie',
  'SVT', 'SES', 'Anglais', 'Histoire-Géo',
];

function getPhase(now = new Date()) {
  if (now < DATE_ECRITS) return 'revision';
  if (now < DATE_RESULTATS) return 'resultats';
  if (now < FIN_RATTRAPAGE) return 'rattrapage';
  return 'apres';
}

function Countdown({ target, label }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const diff = target - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return (
    <div className="inline-flex items-center gap-2 bg-slate-900/80 text-white rounded-xl px-4 py-2 text-sm font-semibold">
      <Clock size={16} className="text-yellow-400" />
      <span>{label}</span>
      <span className="text-yellow-400 tabular-nums">
        {days > 0 ? `${days} j ` : ''}{hours} h {mins} min
      </span>
    </div>
  );
}

const HEROES = {
  revision: {
    title: 'Bac 2026 : la dernière ligne droite se joue maintenant.',
    subtitle: 'Des profs caribéens, en visio ou près de chez toi. Réserve tes heures intensives, paie en 3x.',
    countdownLabel: 'Écrits dans',
    countdownTarget: DATE_ECRITS,
  },
  resultats: {
    title: 'Résultats le 4 juillet. Prépare le rattrapage dès maintenant.',
    subtitle: 'Ne reste pas à attendre : un prof dispo cette semaine peut tout changer pour les oraux de rattrapage.',
    countdownLabel: 'Résultats dans',
    countdownTarget: DATE_RESULTATS,
  },
  rattrapage: {
    title: 'Rattrapage du bac : 48h pour tout jouer. On t’aide à le décrocher.',
    subtitle: 'Un prof dispo cette semaine, sessions intensives, satisfait ou remboursé.',
    countdownLabel: 'Rattrapage dans',
    countdownTarget: DATE_RATTRAPAGE,
  },
  apres: {
    title: 'Prépare ta rentrée avec un prof caribéen.',
    subtitle: 'Remise à niveau pendant les vacances, en visio ou près de chez toi. Paie en 3x.',
    countdownLabel: null,
    countdownTarget: null,
  },
};

const PACKS = [
  {
    pack: 0,
    name: 'SOS 1 matière',
    tagline: 'Une matière qui coince',
    points: ['Cours à l’unité, sans engagement', 'Prof vérifié, visio ou présentiel', 'Idéal pour débloquer un chapitre'],
    discount: '-5 € avec ton code promo',
    highlight: false,
    cta: 'Choisir ce format',
  },
  {
    pack: 5,
    name: 'Pack Intensif 5h',
    tagline: 'La dernière ligne droite',
    points: ['+1h OFFERTE (6h au total)', 'Payable en 3x sans frais (Klarna)', 'Le format le plus choisi avant les épreuves'],
    discount: '-10 € avec ton code promo',
    highlight: true,
    cta: 'Choisir le Pack 5h',
  },
  {
    pack: 10,
    name: 'Pack Prépa 10h',
    tagline: 'Je sécurise mon bac',
    points: ['+2h OFFERTES (12h au total)', 'Payable en 3x sans frais (Klarna)', 'Suivi complet sur plusieurs matières'],
    discount: '-30 € avec ton code promo',
    highlight: false,
    cta: 'Choisir le Pack 10h',
  },
];

const FAQ_ITEMS = [
  {
    q: 'Comment mon code promo est-il appliqué ?',
    a: 'Si tu es arrivé(e) ici avec un code (lien d’un créateur), il est enregistré automatiquement : la remise s’applique toute seule au moment du paiement, tu n’as rien à taper.',
  },
  {
    q: 'Je peux vraiment payer en 3 fois ?',
    a: 'Oui — au paiement, choisis Klarna pour régler en 3 fois sans frais. Apple Pay et Google Pay sont aussi disponibles.',
  },
  {
    q: 'Et si le cours ne me convient pas ?',
    a: 'Première séance satisfait ou remboursé : tu peux demander le remboursement directement depuis ton espace, sans justification.',
  },
];

export default function Bac() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedPack, setSelectedPack] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const subjectsRef = useRef(null);

  const phase = useMemo(() => getPhase(), []);
  const hero = HEROES[phase];
  const promoCode = getCampaignCode();

  useSEO({
    title: 'Soutien scolaire Bac — Guyane & Antilles | EduKaraib',
    description: 'Révisions intensives et rattrapage du bac avec des profs caribéens vérifiés. Visio ou présentiel, payable en 3x, satisfait ou remboursé.',
    url: 'https://edukaraib.com/bac',
  });

  // Capte le code influenceur (?code=XXX) dès l'arrivée → survie jusqu'au paiement
  useEffect(() => {
    const code = (searchParams.get('code') || '').trim().toUpperCase();
    if (code && /^[A-Z0-9-]{4,20}$/.test(code)) {
      saveCampaign({ code });
    }
  }, [searchParams]);

  const choosePack = (pack) => {
    saveCampaign({ pack });
    setSelectedPack(pack);
    // L'étape suivante : choisir sa matière
    setTimeout(() => subjectsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const chooseSubject = (subject) => {
    saveCampaign({ subject });
    // Toujours montrer les profs d'abord (valeur avant la barrière), connecté ou non.
    // L'inscription n'est demandée qu'au clic « contacter le prof » (Search.jsx).
    navigate(`/search?subject=${encodeURIComponent(subject)}`);
  };

  const scrollToPacks = () => {
    document.getElementById('packs')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      {/* ——— HERO ——— */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-primary text-white px-4 pt-12 pb-14">
        <div className="max-w-3xl mx-auto text-center">
          {promoCode && (
            <div className="inline-flex items-center gap-2 bg-green-500/20 border border-green-400/40 text-green-300 rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
              <Ticket size={15} />
              Code {promoCode} activé — ta remise s'appliquera au paiement
            </div>
          )}
          {/* text-white explicite : index.css force h1/h2/h3 en text-gray-800 */}
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-4 text-white">
            {hero.title}
          </h1>
          <p className="text-slate-300 text-base sm:text-lg mb-6">
            {hero.subtitle}
          </p>
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={scrollToPacks}
              className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold px-8 py-3.5 rounded-xl shadow-lg transition text-lg inline-flex items-center gap-2"
            >
              Choisir mon pack <ArrowRight size={18} />
            </button>
            {hero.countdownTarget && (
              <Countdown target={hero.countdownTarget} label={hero.countdownLabel} />
            )}
          </div>
        </div>
      </section>

      {/* ——— PACKS ——— */}
      <section id="packs" className="px-4 py-12 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-2">Choisis ton format</h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Le tarif horaire est fixé par chaque prof — affiché sur son profil. Le prof reçoit toujours 100 % de son tarif.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PACKS.map((p) => (
              <div
                key={p.pack}
                className={`relative bg-white rounded-2xl border-2 p-6 flex flex-col transition shadow-sm ${
                  p.highlight ? 'border-yellow-400 shadow-lg md:-translate-y-2' : 'border-gray-200'
                } ${selectedPack === p.pack ? 'ring-2 ring-primary' : ''}`}
              >
                {p.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-slate-900 text-xs font-bold px-3 py-1 rounded-full">
                    ⭐ Le plus choisi
                  </span>
                )}
                <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                <p className="text-sm text-primary font-semibold mb-3">{p.tagline}</p>
                <ul className="space-y-2 text-sm text-gray-700 flex-1">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2">
                      <BadgeCheck size={16} className="text-green-500 mt-0.5 shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
                {promoCode && (
                  <div className="mt-3 text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 text-center">
                    🎟️ {p.discount.replace('ton code promo', promoCode)}
                  </div>
                )}
                <button
                  onClick={() => choosePack(p.pack)}
                  className={`mt-4 w-full font-bold py-2.5 rounded-xl transition ${
                    p.highlight
                      ? 'bg-yellow-400 hover:bg-yellow-500 text-slate-900'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {p.cta}
                </button>
              </div>
            ))}
          </div>

          {/* ——— Choix matière (étape 2) ——— */}
          <div
            ref={subjectsRef}
            className={`mt-8 bg-white rounded-2xl border-2 p-6 transition ${
              selectedPack !== null ? 'border-primary' : 'border-gray-200 opacity-80'
            }`}
          >
            <h3 className="font-bold text-slate-900 mb-1 text-center">
              {selectedPack !== null ? '👇 Dernière étape : ta matière' : 'Ta matière'}
            </h3>
            <p className="text-center text-gray-500 text-xs mb-4">
              On te montre directement les profs dispo dans cette matière.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUBJECTS_BAC.map((s) => (
                <button
                  key={s}
                  onClick={() => chooseSubject(s)}
                  className="px-4 py-2 rounded-full border-2 border-gray-200 text-sm font-semibold text-gray-700 hover:border-primary hover:text-primary transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ——— COMMENT ÇA MARCHE ——— */}
      <section className="px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">Comment ça marche</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            {[
              { n: '1', t: 'Choisis ton pack', d: 'Et ta matière — 10 secondes.' },
              { n: '2', t: 'Inscris-toi en 30s', d: 'Email, mot de passe, prénom. C’est tout.' },
              { n: '3', t: 'Contacte ton prof', d: 'Message pré-rempli, il te propose un créneau cette semaine. Tu paies après confirmation.' },
            ].map((s) => (
              <div key={s.n}>
                <div className="w-12 h-12 rounded-full bg-primary text-white font-bold text-xl grid place-items-center mx-auto mb-3">
                  {s.n}
                </div>
                <h3 className="font-bold text-slate-900 mb-1">{s.t}</h3>
                <p className="text-sm text-gray-500">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— POURQUOI EDUKARAIB ——— */}
      <section className="px-4 py-12 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">Pourquoi EduKaraib</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: GraduationCap, t: 'Profs caribéens vérifiés', d: 'Des profs qui connaissent ta réalité — Guyane, Antilles, en ligne.' },
              { icon: Video, t: 'Visio ou présentiel', d: 'Cours depuis ton téléphone ou près de chez toi.' },
              { icon: CreditCard, t: 'Paiement en 3x sans frais', d: 'Klarna, Apple Pay, Google Pay — au choix.' },
              { icon: ShieldCheck, t: 'Satisfait ou remboursé', d: 'Première séance remboursable en 1 clic depuis ton espace.' },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="bg-white rounded-xl border border-gray-200 p-5 flex gap-4">
                <Icon size={26} className="text-primary shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm mb-1">{t}</h3>
                  <p className="text-sm text-gray-500">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— TÉMOIGNAGES ——— */}
      {/* ⚠️ À remplacer par de vrais avis clients dès les premières ventes */}
      <section className="px-4 py-12">
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[
            { txt: 'Mon fils a enfin compris les maths avant les épreuves. Le prof était dispo le soir même en visio.', who: 'Parent d’élève · Cayenne' },
            { txt: 'Le paiement en 3 fois m’a permis de prendre le pack 10h sans stresser le budget.', who: 'Élève de Terminale · Martinique' },
          ].map((t) => (
            <div key={t.who} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex gap-0.5 mb-2">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />
                ))}
              </div>
              <p className="text-sm text-gray-700 mb-2">« {t.txt} »</p>
              <p className="text-xs text-gray-400 font-semibold">{t.who}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ——— FAQ ——— */}
      <section className="px-4 py-12 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-6">Questions fréquentes</h2>
          <div className="space-y-3">
            {FAQ_ITEMS.map((f, i) => (
              <div key={f.q} className="bg-white rounded-xl border border-gray-200">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-slate-900 text-sm"
                >
                  {f.q}
                  {openFaq === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {openFaq === i && (
                  <p className="px-5 pb-4 text-sm text-gray-600">{f.a}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">
            D'autres questions ? <Link to="/faq" className="text-primary underline">FAQ complète</Link>
          </p>
        </div>
      </section>

      {/* ——— CTA FINAL ——— */}
      <section className="px-4 py-14 bg-slate-900 text-white text-center">
        <div className="max-w-xl mx-auto">
          <p className="text-yellow-400 font-bold text-sm mb-2">
            🔥 {PROFS_DISPO} profs disponibles cette semaine
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4 text-white">
            {phase === 'rattrapage'
              ? 'Le rattrapage ne t’attendra pas.'
              : 'Chaque jour compte avant les épreuves.'}
          </h2>
          <button
            onClick={scrollToPacks}
            className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold px-8 py-3.5 rounded-xl shadow-lg transition text-lg"
          >
            Choisir mon pack
          </button>
        </div>
      </section>

      {/* ——— CTA collant mobile (82 % du trafic) ——— */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <button
          onClick={scrollToPacks}
          className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 rounded-xl"
        >
          Choisir mon pack{promoCode ? ` · code ${promoCode}` : ''}
        </button>
      </div>
      <div className="md:hidden h-20" aria-hidden="true" />

      <Footer />
    </div>
  );
}
