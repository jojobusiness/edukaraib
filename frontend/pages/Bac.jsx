import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useSEO } from '../hooks/useSEO';
import { saveCampaign, getCampaignCode } from '../lib/bacCampaign';
import { pixelTrack } from '../lib/metaPixel';
import {
  GraduationCap, Clock, ShieldCheck, CreditCard, Video, BadgeCheck,
  ChevronDown, ChevronUp, Star, ArrowRight, Ticket, Sparkles,
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
    price: '≈ 30 €',
    priceNote: 'l’heure',
    points: ['Cours à l’unité, sans engagement', 'Prof vérifié, visio ou présentiel', 'Idéal pour débloquer un chapitre'],
    discount: '-5 € avec ton code promo',
    highlight: false,
    cta: 'Choisir ce format',
  },
  {
    pack: 5,
    name: 'Pack Intensif 5h',
    tagline: 'La dernière ligne droite',
    price: '≈ 150 €',
    priceNote: '6h de cours · soit ~25 €/h',
    points: ['+1h OFFERTE (6h au total)', 'Payable en 3x sans frais (Klarna)', 'Le format le plus choisi avant les épreuves'],
    discount: '-10 € avec ton code promo',
    highlight: true,
    cta: 'Choisir le Pack 5h',
  },
  {
    pack: 10,
    name: 'Pack Prépa 10h',
    tagline: 'Je sécurise mon bac',
    price: '≈ 300 €',
    priceNote: '12h de cours · soit ~25 €/h',
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
  const [profs, setProfs] = useState([]);
  const [profsLoading, setProfsLoading] = useState(true);
  const subjectsRef = useRef(null);
  const profsRef = useRef(null);

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

  // Meta Pixel : vue de la landing campagne
  useEffect(() => {
    pixelTrack('ViewContent', { content_name: 'Landing Bac', content_category: 'campagne' });
  }, []);

  // ——— Profs dispo cette semaine (valeur AVANT la barrière prix) ———
  // On réutilise la logique de Search.jsx : profs + enrichissement note moyenne.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'teacher')));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const ids = data.map((t) => t.id).filter(Boolean);
        const stats = {};
        for (let i = 0; i < ids.length; i += 10) {
          const chunk = ids.slice(i, i + 10);
          try {
            const rs = await getDocs(query(collection(db, 'reviews'), where('teacher_id', 'in', chunk)));
            rs.docs.forEach((d) => {
              const r = d.data();
              const tid = r.teacher_id;
              const rating = Number(r.rating || 0);
              if (!tid || rating <= 0) return;
              if (!stats[tid]) stats[tid] = { sum: 0, count: 0 };
              stats[tid].sum += rating;
              stats[tid].count += 1;
            });
          } catch (_) {}
        }

        const enriched = data.map((t) => {
          const s = stats[t.id];
          const reviewsCount = s ? s.count : Number(t.reviewsCount ?? 0);
          const avgRating = s ? s.sum / s.count : Number(t.avgRating ?? 0);
          return { ...t, reviewsCount, avgRating };
        });

        // Filtre QUALITÉ (volontairement plus strict que offer_enabled seul) :
        // un prof "fantôme" (avatar par défaut + 0 avis) détruit la confiance autant
        // que le mur de prix. On exige une vraie photo OU au moins un avis.
        const showable = enriched.filter((t) => {
          if (t.offer_enabled === false) return false;
          const hasPhoto = !!t.avatarUrl;
          const hasReview = (t.reviewsCount ?? 0) >= 1;
          return hasPhoto || hasReview;
        });

        // Tri : certifiés (≥5 avis) d'abord, puis meilleure note, puis profs de matière bac.
        const teachesBac = (t) => {
          const subj = Array.isArray(t.subjects) ? t.subjects : [t.subjects || t.subject || ''];
          const txt = subj.join(' ').toLowerCase();
          return SUBJECTS_BAC.some((s) => txt.includes(s.toLowerCase()));
        };
        showable.sort((a, b) => {
          const certA = (a.reviewsCount ?? 0) >= 5 ? 1 : 0;
          const certB = (b.reviewsCount ?? 0) >= 5 ? 1 : 0;
          if (certA !== certB) return certB - certA;
          if ((b.avgRating ?? 0) !== (a.avgRating ?? 0)) return (b.avgRating ?? 0) - (a.avgRating ?? 0);
          return (teachesBac(b) ? 1 : 0) - (teachesBac(a) ? 1 : 0);
        });

        if (alive) setProfs(showable.slice(0, 6));
      } catch (_) {
        if (alive) setProfs([]);
      } finally {
        if (alive) setProfsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

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

  const scrollToProfs = () => {
    const el = document.getElementById('profs-dispo');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    else navigate('/search'); // secours si la section est masquée (< 3 profs)
  };

  const showProfsSection = profsLoading || profs.length >= 3;

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
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={scrollToPacks}
                className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold px-8 py-3.5 rounded-xl shadow-lg transition text-lg inline-flex items-center gap-2"
              >
                Choisir mon pack <ArrowRight size={18} />
              </button>
              {showProfsSection && (
                <button
                  onClick={scrollToProfs}
                  className="border border-white/30 text-white font-semibold px-6 py-3.5 rounded-xl hover:bg-white/10 transition inline-flex items-center gap-2"
                >
                  Voir les profs dispo <ArrowRight size={16} />
                </button>
              )}
            </div>
            {hero.countdownTarget && (
              <Countdown target={hero.countdownTarget} label={hero.countdownLabel} />
            )}
          </div>
        </div>
      </section>

      {/* ——— PROFS DISPO CETTE SEMAINE (valeur avant la barrière prix) ——— */}
      {showProfsSection && (
        <section id="profs-dispo" ref={profsRef} className="px-4 py-12">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-center text-slate-900 mb-1">
              Des profs dispo cette semaine
            </h2>
            <p className="text-center text-gray-500 text-sm mb-8">
              Caribéens, vérifiés — visio ou près de chez toi. Choisis, puis réserve tes heures.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profsLoading
                ? Array.from({ length: 3 }).map((_, i) => <ProfCardSkeleton key={i} />)
                : profs.map((t) => (
                    <ProfPreviewCard key={t.id} teacher={t} navigate={navigate} />
                  ))}
            </div>

            <div className="text-center mt-8">
              <button
                onClick={() => {
                  pixelTrack('ViewContent', { content_name: 'Profs preview Bac — voir tous', content_category: 'campagne' });
                  navigate('/search');
                }}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold px-7 py-3 rounded-xl transition"
              >
                Voir tous les profs <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ——— PACKS ——— */}
      <section id="packs" className="px-4 py-12 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-2">Choisis ton format</h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Prix estimés sur la base d’un tarif moyen de 30 €/h. Le tarif exact est fixé par chaque prof — affiché sur son profil. Le prof reçoit toujours 100 % de son tarif.
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
                <div className="mb-3 pb-3 border-b border-gray-100">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold text-slate-900">{p.price}</span>
                    <span className="text-sm text-gray-500">{p.priceNote}</span>
                  </div>
                  {p.pack !== 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">ou en 3x sans frais avec Klarna</p>
                  )}
                </div>
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
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-t border-gray-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <div className="relative">
          {/* halo qui respire (visible aussi sur mobile, sans hover) */}
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-amber-400/50 blur-lg animate-pulse" aria-hidden="true" />
          <button
            onClick={scrollToPacks}
            className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-slate-900 font-extrabold py-3.5 shadow-lg shadow-amber-500/40 active:scale-[0.97] transition-transform duration-150"
          >
            {/* reflet qui balaie (bonus desktop au survol) */}
            <span className="pointer-events-none absolute inset-y-0 -left-10 w-10 skew-x-12 bg-white/50 blur-sm transition-transform duration-700 ease-out group-hover:translate-x-[320%]" aria-hidden="true" />
            <span className="relative flex items-center justify-center gap-2 text-base">
              <Sparkles size={18} className="animate-pulse" />
              Choisir mon pack{promoCode ? ` · ${promoCode}` : ''}
              <ArrowRight size={18} className="transition-transform group-active:translate-x-1" />
            </span>
          </button>
        </div>
      </div>
      <div className="md:hidden h-24" aria-hidden="true" />

      <Footer />
    </div>
  );
}

/* ——— Carte prof compacte (sous-ensemble de TeacherCard de Search.jsx) ——— */
function ProfPreviewCard({ teacher, navigate }) {
  const parsePrice = (raw) => {
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const presEnabled = !!(teacher.presentiel_enabled ?? teacher.presentiel ?? teacher.mode_inperson ?? teacher.in_person);
  const visioEnabled = !!(teacher.visio_enabled ?? teacher.visio ?? teacher.mode_online ?? teacher.online);
  const presBase = presEnabled ? parsePrice(teacher.price_per_hour ?? teacher.price) : null;
  const visioRaw = teacher.visio_same_rate ? (teacher.price_per_hour ?? teacher.price) : teacher.visio_price_per_hour;
  const visioBase = visioEnabled ? parsePrice(visioRaw) : null;
  const prices = [presBase, visioBase].filter((p) => typeof p === 'number').map((p) => p + 10);
  const fromPrice = prices.length ? Math.min(...prices) : null;

  const firstName = (teacher.fullName || '').trim().split(' ')[0] || 'Professeur';
  const subjectsText = Array.isArray(teacher.subjects)
    ? teacher.subjects.slice(0, 3).join(', ')
    : (teacher.subjects || teacher.subject || teacher.matiere || 'Matières variées');
  const rating = Number(teacher.avgRating ?? 0);
  const reviewsCount = Number(teacher.reviewsCount ?? 0);
  const certified = reviewsCount >= 5;

  const goProfile = () => {
    pixelTrack('ViewContent', { content_name: 'Profs preview Bac — carte prof', content_category: 'campagne' });
    navigate(`/profils/${teacher.id || teacher.uid}`);
  };

  return (
    <div
      onClick={goProfile}
      className="cursor-pointer bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition p-4 flex flex-col"
    >
      <div className="flex items-center gap-3">
        <img
          src={teacher.avatarUrl || '/avatar-default.png'}
          alt={firstName}
          className="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-bold text-slate-900 truncate">{firstName}</h3>
            {certified && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                <BadgeCheck size={12} /> Certifié
              </span>
            )}
          </div>
          {rating > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-600 font-semibold">
              <Star size={13} className="fill-amber-400 text-amber-400" />
              {rating.toFixed(1)} <span className="text-gray-400 font-normal">({reviewsCount})</span>
            </span>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-700 font-medium mt-3 line-clamp-1">{subjectsText}</div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {visioEnabled && <span className="px-2 py-0.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600">📹 Visio</span>}
        {presEnabled && <span className="px-2 py-0.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600">📍 Présentiel</span>}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {fromPrice != null ? `à partir de ${fromPrice.toFixed(0)} €/h` : 'Prix sur demande'}
        </span>
        <span className="text-sm font-semibold text-primary inline-flex items-center gap-1">
          Voir <ArrowRight size={14} />
        </span>
      </div>
    </div>
  );
}

function ProfCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-xl bg-gray-200 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-1/3" />
        </div>
      </div>
      <div className="h-3 bg-gray-200 rounded w-2/3 mt-4" />
      <div className="h-3 bg-gray-200 rounded w-1/3 mt-3" />
    </div>
  );
}
