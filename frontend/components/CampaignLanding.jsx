import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import Navbar from './Navbar';
import Footer from './Footer';
import { useSEO } from '../hooks/useSEO';
import { saveCampaign, getCampaignCode } from '../lib/bacCampaign';
import { pixelTrack } from '../lib/metaPixel';
import { subjectMatches } from '../lib/subjectMatch';
import {
  GraduationCap, Clock, ShieldCheck, CreditCard, Video, BadgeCheck,
  ChevronDown, ChevronUp, Star, ArrowRight, Ticket, Sparkles,
} from 'lucide-react';

/* ————————————————————————————————————————————————————————————
   Moteur de landing campagne, partagé par `/bac` et `/rentree`.

   Ce composant vit dans `components/` et non dans `pages/` À DESSEIN : il
   exige une prop `config` et n’est jamais monté seul par le routeur. Le test
   de fumée (`frontend/test/pages.test.jsx`) monte automatiquement CHAQUE
   fichier de `pages/**` sans props — l’y placer aurait rendu ce test rouge.

   Toute chaîne visible par l’utilisateur vient de `config.copy` : c’est ce qui
   permet à `/bac` de tutoyer (l’élève achète) pendant que `/rentree` vouvoie
   (le parent paie), sans mélange des deux voix dans une même page.
   ———————————————————————————————————————————————————————————— */

const ICONES = { GraduationCap, Video, CreditCard, ShieldCheck };

/**
 * Nombre de créneaux de disponibilité cochés par un prof.
 * `availability` mélange l’ancien et le nouveau format dans la même base (cf.
 * le crash profil prof du 12/06) : on route par type plutôt que de supposer.
 * Aucune requête supplémentaire — le champ est déjà dans le document `users`.
 */
export function nbCreneaux(availability) {
  if (!availability) return 0;
  if (Array.isArray(availability)) return availability.length;
  if (typeof availability === 'object') {
    return Object.values(availability).reduce(
      (n, v) => n + (Array.isArray(v) ? v.length : (v ? 1 : 0)),
      0,
    );
  }
  return 0;
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

export default function CampaignLanding({ config }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedPack, setSelectedPack] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [profs, setProfs] = useState([]);
  const [profsTotal, setProfsTotal] = useState(0);
  const [profsReservables, setProfsReservables] = useState(0);
  const [allProfs, setAllProfs] = useState([]);
  const [profsLoading, setProfsLoading] = useState(true);
  const subjectsRef = useRef(null);
  const profsRef = useRef(null);

  const phase = useMemo(() => config.getPhase(), [config]);
  const hero = config.heroes[phase] ?? config.heroes.apres;
  const copy = config.copy;
  const promoCode = getCampaignCode();

  useSEO(config.seo);

  // Capte le code influenceur (?code=XXX) dès l'arrivée → survie jusqu'au paiement
  useEffect(() => {
    const code = (searchParams.get('code') || '').trim().toUpperCase();
    if (code && /^[A-Z0-9-]{4,20}$/.test(code)) {
      saveCampaign({ code });
    }
  }, [searchParams]);

  // Meta Pixel : vue de la landing campagne
  useEffect(() => {
    pixelTrack('ViewContent', { content_name: config.pixelName, content_category: 'campagne' });
  }, [config.pixelName]);

  // ——— Profs dispo (valeur AVANT la barrière prix) ———
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
          return { ...t, reviewsCount, avgRating, reservable: nbCreneaux(t.availability) > 0 };
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

        // Tri : RÉSERVABLES D'ABORD (créneaux cochés), puis certifiés (≥5 avis),
        // puis meilleure note, puis profs enseignant une matière de la campagne.
        //
        // Pourquoi les créneaux passent devant tout le reste (mesure du 26/08) :
        // sur « Maths », 9 profs s'affichaient et 3 seulement étaient
        // réservables — le parent avait 2 chances sur 3 de cliquer sur un
        // planning vide, au moment où il est le plus décidé à réserver.
        //
        // ⚠️ On ne MASQUE pas les profs sans créneau : ce sont les mieux notés
        // de la plateforme (34 avis cumulés à 5,0) et un parent peut vouloir les
        // contacter pour convenir d'un horaire. On les fait descendre.
        const teachesCampaignSubject = (t) => {
          const subj = Array.isArray(t.subjects) ? t.subjects : [t.subjects || t.subject || ''];
          const txt = subj.join(' ');
          return config.subjects.some((s) => subjectMatches(s, txt));
        };
        showable.sort((a, b) => {
          if (a.reservable !== b.reservable) return a.reservable ? -1 : 1;
          const certA = (a.reviewsCount ?? 0) >= 5 ? 1 : 0;
          const certB = (b.reviewsCount ?? 0) >= 5 ? 1 : 0;
          if (certA !== certB) return certB - certA;
          if ((b.avgRating ?? 0) !== (a.avgRating ?? 0)) return (b.avgRating ?? 0) - (a.avgRating ?? 0);
          return (teachesCampaignSubject(b) ? 1 : 0) - (teachesCampaignSubject(a) ? 1 : 0);
        });

        if (alive) {
          setProfsTotal(showable.length);
          setProfsReservables(showable.filter((t) => t.reservable).length);
          setAllProfs(showable);
          setProfs(showable.slice(0, 6));
        }
      } catch (_) {
        if (alive) setProfs([]);
      } finally {
        if (alive) setProfsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [config.subjects]);

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

  // ——— Matières réellement couvertes ———
  // Un bouton de matière sans aucun prof correspondant envoie l'utilisateur sur
  // une liste sans rapport (mesuré le 26/08 : /bac proposait Philosophie, SVT,
  // SES et Histoire-Géo alors qu'AUCUN prof ne les enseigne).
  // On filtre à l'affichage plutôt que dans la config : ces matières restent
  // légitimes pour le bac 2027 et le bouton réapparaîtra tout seul le jour où un
  // prof de la matière s'inscrit. Zéro maintenance.
  // Filet : si le filtre laisse moins de 3 matières — chargement en cours,
  // requête échouée, base vide — on retombe sur la liste complète configurée
  // plutôt que d'afficher une étape de tunnel vide.
  const subjectsAffichees = useMemo(() => {
    if (profsLoading || allProfs.length === 0) return config.subjects;
    const couvertes = config.subjects.filter((s) =>
      allProfs.some((t) => {
        const subj = Array.isArray(t.subjects) ? t.subjects : [t.subjects || t.subject || ''];
        return subjectMatches(s, subj.join(' '));
      }),
    );
    return couvertes.length >= 3 ? couvertes : config.subjects;
  }, [config.subjects, allProfs, profsLoading]);

  // Rareté affichée : on annonce les nombres RÉELS, jamais un chiffre codé en
  // dur. Un chiffre gonflé se démonte au clic suivant. On distingue les profs
  // vérifiés (affichables) de ceux qui ont réellement des créneaux ouverts —
  // annoncer les premiers comme « disponibles » serait faux.
  const profsAnnonces = {
    verifies: profsTotal > 0 ? profsTotal : config.profsFallback,
    disponibles: profsReservables,
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
              Code {promoCode} activé — la remise s'appliquera au paiement
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
                {copy.heroCtaPrimary} <ArrowRight size={18} />
              </button>
              {showProfsSection && (
                <button
                  onClick={scrollToProfs}
                  className="border border-white/30 text-white font-semibold px-6 py-3.5 rounded-xl hover:bg-white/10 transition inline-flex items-center gap-2"
                >
                  {copy.heroCtaSecondary} <ArrowRight size={16} />
                </button>
              )}
            </div>
            {hero.countdownTarget && (
              <Countdown target={hero.countdownTarget} label={hero.countdownLabel} />
            )}
          </div>
        </div>
      </section>

      {/* ——— PROFS DISPO (valeur avant la barrière prix) ——— */}
      {showProfsSection && (
        <section id="profs-dispo" ref={profsRef} className="px-4 py-12">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-center text-slate-900 mb-1">
              {copy.profsTitle}
            </h2>
            <p className="text-center text-gray-500 text-sm mb-8">
              {copy.profsSubtitle}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profsLoading
                ? Array.from({ length: 3 }).map((_, i) => <ProfCardSkeleton key={i} />)
                : profs.map((t) => (
                    <ProfPreviewCard key={t.id} teacher={t} navigate={navigate} campaignId={config.id} />
                  ))}
            </div>

            <div className="text-center mt-8">
              <button
                onClick={() => {
                  pixelTrack('ViewContent', { content_name: `Profs preview ${config.id} — voir tous`, content_category: 'campagne' });
                  navigate('/search');
                }}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold px-7 py-3 rounded-xl transition"
              >
                {copy.profsCtaAll} <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ——— PACKS ——— */}
      <section id="packs" className="px-4 py-12 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-2">{copy.packsTitle}</h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Prix estimés sur la base d’un tarif moyen de 30 €/h. Le tarif exact est fixé par chaque prof — affiché sur son profil. Le prof reçoit toujours 100 % de son tarif.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {config.packs.map((p) => (
              <div
                key={p.pack}
                className={`relative bg-white rounded-2xl border-2 p-6 flex flex-col transition shadow-sm ${
                  p.highlight ? 'border-yellow-400 shadow-lg md:-translate-y-2' : 'border-gray-200'
                } ${selectedPack === p.pack ? 'ring-2 ring-primary' : ''}`}
              >
                {p.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-slate-900 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    {copy.badgeLabel}
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
                    🎟️ {p.discount.replace(/(ton|votre) code promo/, promoCode)}
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
              {selectedPack !== null ? copy.subjectsTitleActive : copy.subjectsTitleIdle}
            </h3>
            <p className="text-center text-gray-500 text-xs mb-4">
              {copy.subjectsNote}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {subjectsAffichees.map((s) => (
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
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">{copy.stepsTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            {copy.steps.map((s) => (
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
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">{copy.whyTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {copy.why.map(({ icon, t, d }) => {
              const Icon = ICONES[icon] ?? GraduationCap;
              return (
                <div key={t} className="bg-white rounded-xl border border-gray-200 p-5 flex gap-4">
                  <Icon size={26} className="text-primary shrink-0" />
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm mb-1">{t}</h3>
                    <p className="text-sm text-gray-500">{d}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ——— TÉMOIGNAGES (si la campagne en a de vrais) ——— */}
      {/* ⚠️ /bac porte encore deux témoignages inventés : à remplacer par de
          vrais avis dès les premières ventes. /rentree affiche à la place des
          preuves vérifiables (`proofPoints`) — on ne fabrique pas d’avis. */}
      {copy.testimonials?.length > 0 && (
        <section className="px-4 py-12">
          <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-5">
            {copy.testimonials.map((t) => (
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
      )}

      {/* ——— PREUVES VÉRIFIABLES (remplace les témoignages quand il n'y en a pas) ——— */}
      {copy.proofPoints?.length > 0 && (
        <section className="px-4 py-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-center text-slate-900 mb-8">
              Ce qui est garanti, noir sur blanc
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {copy.proofPoints.map((p) => (
                <div key={p.t} className="bg-white rounded-xl border border-gray-200 p-5 flex gap-3">
                  <BadgeCheck size={20} className="text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm mb-1">{p.t}</h3>
                    <p className="text-sm text-gray-500">{p.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ——— FAQ ——— */}
      <section className="px-4 py-12 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-slate-900 mb-6">{copy.faqTitle}</h2>
          <div className="space-y-3">
            {config.faq.map((f, i) => (
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
            {copy.scarcity(profsAnnonces)}
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4 text-white">
            {copy.finalCta(phase)}
          </h2>
          <button
            onClick={scrollToPacks}
            className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold px-8 py-3.5 rounded-xl shadow-lg transition text-lg"
          >
            {copy.heroCtaPrimary}
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
              {copy.stickyCta}{promoCode ? ` · ${promoCode}` : ''}
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
function ProfPreviewCard({ teacher, navigate, campaignId }) {
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
    pixelTrack('ViewContent', { content_name: `Profs preview ${campaignId} — carte prof`, content_category: 'campagne' });
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
          {/* « Créneaux ouverts » et non « Disponible cette semaine » :
              `availability` est une grille hebdomadaire de disponibilités, pas
              un agenda de créneaux libres — un créneau ouvert peut déjà être
              réservé. On affirme ce qui est vrai : le prof a ouvert des
              créneaux, donc il est réservable. */}
          {teacher.reservable && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <Clock size={11} /> Créneaux ouverts
            </span>
          )}
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
