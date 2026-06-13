import React, { useEffect, useRef, useState, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';
import { pixelTrack } from '../lib/metaPixel';

const PAGE_SIZE = 10;

const SUGGESTED_SUBJECTS = [
  'Mathématiques', 'Français', 'Anglais', 'Physique-Chimie',
  'Créole', 'SVT', 'Informatique', 'Musique',
];

export default function Search() {
  const [teachers, setTeachers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showSugg, setShowSugg]     = useState(false);
  const [visibleCount, setVisible]  = useState(PAGE_SIZE);
  const searchRef                   = useRef(null);
  const navigate                    = useNavigate();
  const [searchParams]              = useSearchParams();

  // Pré-remplir depuis URL
  useEffect(() => {
    const subj = searchParams.get('subject');
    const cityParam = searchParams.get('city');
    const lvl = searchParams.get('level');
    if (subj) setSearch(subj);
    if (cityParam) setCity(cityParam);
    if (lvl) setLevel(lvl);
    // Meta Pixel : vue de la liste de profs (intention forte)
    pixelTrack('ViewContent', {
      content_type: 'product_group',
      content_name: 'Recherche profs',
      content_category: subj || 'toutes matières',
    });
  }, []);

  // Filtres
  const [level,    setLevel]    = useState('');
  const [city,     setCity]     = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sortBy,   setSortBy]   = useState('');
  const [mode,     setMode]     = useState('');

  // Reset pagination à chaque changement de filtre
  useEffect(() => { setVisible(PAGE_SIZE); }, [search, city, level, mode, priceMin, priceMax, sortBy]);

  // Fermer suggestions au clic dehors
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSugg(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleBack = () => {
    if (auth.currentUser) navigate('/smart-dashboard');
    else navigate('/');
  };

  // Chargement profs + stats
  useEffect(() => {
    const fetchTeachers = async () => {
      const qy = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const snap = await getDocs(qy);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      const ids = data.map(t => t.id).filter(Boolean);
      const stats = {};
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        try {
          const rs = await getDocs(query(collection(db, 'reviews'), where('teacher_id', 'in', chunk)));
          rs.docs.forEach(d => {
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

      const enriched = data.map(t => {
        const s = stats[t.id];
        return s
          ? { ...t, reviewsCount: s.count, avgRating: s.sum / s.count }
          : { ...t, reviewsCount: t.reviewsCount ?? 0, avgRating: t.avgRating ?? 0 };
      });
      setTeachers(enriched);
      setLoading(false);
    };
    fetchTeachers().catch(() => setLoading(false));
  }, []);

  // Autocomplete : sujets dynamiques depuis les profs + liste fixe
  const allSubjects = useMemo(() => {
    const set = new Set(SUGGESTED_SUBJECTS);
    teachers.forEach(t => {
      const s = t.subjects;
      if (Array.isArray(s)) s.forEach(x => x && set.add(x.trim()));
      else if (typeof s === 'string' && s.trim()) set.add(s.trim());
    });
    return [...set];
  }, [teachers]);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SUGGESTED_SUBJECTS.slice(0, 6);
    return allSubjects
      .filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      .slice(0, 6);
  }, [search, allSubjects]);

  // Helpers prix / filtres
  const parsePrice = (raw) => {
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const getSubjectsText = (subs) => {
    if (Array.isArray(subs)) return subs.join(' ');
    if (typeof subs === 'string') return subs;
    return '';
  };
  const hasLevel = (t, lvl) => {
    if (!lvl) return true;
    const lv = t.level || t.levels || t.teaching_levels;
    if (Array.isArray(lv)) return lv.includes(lvl);
    if (typeof lv === 'string') return lv.toLowerCase().includes(lvl.toLowerCase());
    return false;
  };
  const matchesMode = (t, m) => {
    if (!m) return true;
    const online   = !!(t.visio_enabled ?? t.mode_online ?? t.online ?? t.visio);
    const inperson = !!(t.presentiel_enabled ?? t.mode_inperson ?? t.presentiel ?? t.in_person);
    if (m === 'visio') return online;
    if (m === 'presentiel') return inperson;
    return true;
  };
  const matchesCity = (t, c) => {
    if (!c) return true;
    return (t.city || t.location || '').toLowerCase().includes(c.toLowerCase());
  };
  const getHourlyPrices = (t) => {
    const presEnabled  = !!(t.presentiel_enabled ?? t.presentiel ?? t.mode_inperson ?? t.in_person);
    const visioEnabled = !!(t.visio_enabled ?? t.visio ?? t.mode_online ?? t.online);
    const pres  = presEnabled  ? parsePrice(t.price_per_hour ?? t.price) : null;
    const visioRaw = t.visio_same_rate ? (t.price_per_hour ?? t.price) : t.visio_price_per_hour;
    const visio = visioEnabled ? parsePrice(visioRaw) : null;
    return { pres, visio };
  };
  const priceForFilters = (t, m) => {
    const { pres, visio } = getHourlyPrices(t);
    if (m === 'visio') return visio;
    if (m === 'presentiel') return pres;
    const c = [pres, visio].filter(x => typeof x === 'number');
    return c.length ? Math.min(...c) : null;
  };

  // Filtrage de base
  const baseFiltered = useMemo(() => {
    const min = priceMin ? Number(priceMin) : null;
    const max = priceMax ? Number(priceMax) : null;
    let list = teachers.filter(t => {
      if (t.offer_enabled === false) return false;
      if (!hasLevel(t, level)) return false;
      if (!matchesCity(t, city)) return false;
      if (!matchesMode(t, mode)) return false;
      const p = priceForFilters(t, mode);
      if (min != null && (p == null || p < min)) return false;
      if (max != null && (p == null || p > max)) return false;
      return true;
    });
    if (sortBy) {
      const po = x => priceForFilters(x, mode);
      if (sortBy === 'priceAsc')   list = list.slice().sort((a, b) => (po(a) ?? 1e9) - (po(b) ?? 1e9));
      if (sortBy === 'priceDesc')  list = list.slice().sort((a, b) => (po(b) ?? -1e9) - (po(a) ?? -1e9));
      if (sortBy === 'ratingDesc') list = list.slice().sort((a, b) => Number(b.avgRating ?? 0) - Number(a.avgRating ?? 0));
    }
    return list;
  }, [teachers, level, city, mode, priceMin, priceMax, sortBy]);

  const q = search.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return [];
    return baseFiltered.filter(t => {
      const name = (t.fullName || '').toLowerCase();
      const subs = getSubjectsText(t.subjects).toLowerCase();
      const tc   = (t.city || t.location || '').toLowerCase();
      const bio  = (t.bio || '').toLowerCase();
      return name.includes(q) || subs.includes(q) || tc.includes(q) || bio.includes(q);
    });
  }, [baseFiltered, q]);

  const others = useMemo(() => {
    if (!q) return baseFiltered;
    const ids = new Set(results.map(r => r.id));
    return baseFiltered.filter(t => !ids.has(t.id));
  }, [baseFiltered, results, q]);

  const totalFiltered = q ? results.length + others.length : others.length;
  const hasActiveFilters = !!(search || city || level || mode || priceMin || priceMax);

  const clearFilters = () => {
    setSearch(''); setCity(''); setLevel('');
    setMode(''); setPriceMin(''); setPriceMax(''); setSortBy('');
  };

  const toggleMode = (target) => setMode(prev => prev === target ? '' : target);

  const pickSuggestion = (s) => {
    setSearch(s);
    setShowSugg(false);
  };

  const cityOptions = useMemo(() =>
    Array.from(new Set(teachers.map(t => (t.city || t.location || '').trim()).filter(Boolean))).sort(),
  [teachers]);

  useSEO({
    title: 'Rechercher un professeur — Caraïbe & Monde',
    description: 'Comparez les professeurs particuliers dans toute la Caraïbe et au-delà, par matière, ville, tarif et niveau. Trouvez le prof idéal sur EduKaraib.',
    url: '/recherche-prof',
  });

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Barre sticky ─────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium transition"
          >
            ← Retour
          </button>

          {/* Barre recherche + autocomplete */}
          <div ref={searchRef} className="flex-1 max-w-2xl relative">
            <div className={`flex items-center rounded-xl border bg-white overflow-visible transition ${showSugg ? 'border-primary ring-2 ring-primary/20' : 'border-gray-300'}`}>
              <span className="pl-3 text-gray-400 shrink-0">🔍</span>
              <input
                type="text"
                placeholder="Matière, prof, ville… (ex: Maths, Anglais)"
                value={search}
                onChange={e => { setSearch(e.target.value); setShowSugg(true); }}
                onFocus={() => setShowSugg(true)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowSugg(false);
                  if (e.key === 'Enter')  setShowSugg(false);
                }}
                className="flex-1 px-3 py-2.5 outline-none bg-transparent text-sm"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setShowSugg(false); }}
                  className="px-2 text-gray-400 hover:text-gray-700 text-lg leading-none"
                >×</button>
              )}
            </div>

            {/* Dropdown suggestions */}
            {showSugg && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 overflow-hidden">
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {search.trim() ? 'Suggestions' : 'Matières populaires'}
                </div>
                {suggestions.map(s => (
                  <button
                    key={s}
                    onMouseDown={() => pickSuggestion(s)}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-primary/5 hover:text-primary flex items-center gap-2 transition"
                  >
                    <span className="text-gray-400">📚</span> {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Modes visio/présentiel (desktop) */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              onClick={() => toggleMode('visio')}
              className={`px-3 py-1.5 rounded-full text-sm border font-medium transition ${mode === 'visio' ? 'bg-primary text-white border-primary' : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'}`}
            >
              📹 Visio
            </button>
            <button
              onClick={() => toggleMode('presentiel')}
              className={`px-3 py-1.5 rounded-full text-sm border font-medium transition ${mode === 'presentiel' ? 'bg-primary text-white border-primary' : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'}`}
            >
              📍 Présentiel
            </button>
          </div>
        </div>
      </div>

      {/* ── Header titre + compteur ──────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pt-5 pb-1 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            {search.trim() ? search.trim() : 'Professeurs particuliers'}{city ? ` à ${city}` : ' dans toute la Caraïbe'}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Chargement…' : `${totalFiltered} professeur${totalFiltered > 1 ? 's' : ''} disponible${totalFiltered > 1 ? 's' : ''}`}
          </p>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-red-500 hover:text-red-700 font-medium border border-red-200 rounded-full px-3 py-1 hover:bg-red-50 transition"
          >
            ✕ Réinitialiser les filtres
          </button>
        )}
      </div>

      {/* ── Filtres mobiles ──────────────────────────────────── */}
      <div className="md:hidden max-w-6xl mx-auto px-4 pb-3 pt-2">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {['', 'visio', 'presentiel'].map(m => (
            <button
              key={m || 'all'}
              onClick={() => setMode(m)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border font-medium transition ${mode === m ? 'bg-primary text-white border-primary' : 'bg-white border-gray-300 text-gray-700'}`}
            >
              {m === '' ? 'Tous' : m === 'visio' ? '📹 Visio' : '📍 Présentiel'}
            </button>
          ))}
          <select value={level} onChange={e => setLevel(e.target.value)} className="shrink-0 border border-gray-300 rounded-full px-3 py-1.5 text-sm bg-white">
            <option value="">Tous niveaux</option>
            {['Primaire','Collège','Lycée','Supérieur','Adulte'].map(l => <option key={l}>{l}</option>)}
          </select>
          <select value={city} onChange={e => setCity(e.target.value)} className="shrink-0 border border-gray-300 rounded-full px-3 py-1.5 text-sm bg-white">
            <option value="">Toute la Caraïbe</option>
            {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="shrink-0 border border-gray-300 rounded-full px-3 py-1.5 text-sm bg-white">
            <option value="">Trier par</option>
            <option value="ratingDesc">⭐ Meilleure note</option>
            <option value="priceAsc">Prix ↑</option>
            <option value="priceDesc">Prix ↓</option>
          </select>
        </div>
      </div>

      {/* ── Layout principal ─────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-6">

        {/* Sidebar desktop */}
        <aside className="hidden md:block md:col-span-4 lg:col-span-3">
          <div className="md:sticky md:top-20 space-y-3">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Mode de cours</h3>
              <div className="flex flex-wrap gap-2">
                {[['', 'Tous'], ['visio', '📹 Visio'], ['presentiel', '📍 Présentiel']].map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${mode === m ? 'bg-primary text-white border-primary' : 'bg-white hover:bg-gray-100 border-gray-300 text-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Niveau scolaire</h3>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={level} onChange={e => setLevel(e.target.value)}>
                <option value="">Tous niveaux</option>
                {['Primaire','Collège','Lycée','Supérieur','Adulte'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Ville / Territoire</h3>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={city} onChange={e => setCity(e.target.value)}>
                <option value="">Toute la Caraïbe</option>
                {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Tarif horaire</h3>
              <div className="flex items-center gap-2">
                <input type="number" min="0" placeholder="Min €" className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm" value={priceMin} onChange={e => setPriceMin(e.target.value)} />
                <input type="number" min="0" placeholder="Max €" className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm" value={priceMax} onChange={e => setPriceMax(e.target.value)} />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Trier par</h3>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="">Pertinence</option>
                <option value="ratingDesc">Meilleure note</option>
                <option value="priceAsc">Prix croissant</option>
                <option value="priceDesc">Prix décroissant</option>
              </select>
            </div>
          </div>
        </aside>

        {/* Résultats */}
        <main className="md:col-span-8 lg:col-span-9 space-y-4">

          {/* Skeleton */}
          {loading && Array.from({ length: 5 }).map((_, i) => <TeacherCardSkeleton key={i} />)}

          {/* Résultats recherche texte */}
          {!loading && q && results.length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
                {results.length} résultat{results.length > 1 ? 's' : ''} pour « {search.trim()} »
              </div>
              {results.slice(0, visibleCount).map(t => <TeacherCard key={t.id} teacher={t} navigate={navigate} />)}
            </>
          )}

          {/* Autres profs */}
          {!loading && others.length > 0 && (
            <>
              {q && results.length > 0 && (
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 pt-2">
                  Autres professeurs disponibles
                </div>
              )}
              {others.slice(0, visibleCount).map(t => <TeacherCard key={t.id} teacher={t} navigate={navigate} />)}
            </>
          )}

          {/* Voir plus */}
          {!loading && totalFiltered > visibleCount && (
            <div className="text-center pt-4">
              <button
                onClick={() => setVisible(v => v + PAGE_SIZE)}
                className="px-6 py-3 rounded-xl border-2 border-primary text-primary font-semibold hover:bg-primary hover:text-white transition"
              >
                Voir {Math.min(PAGE_SIZE, totalFiltered - visibleCount)} professeurs de plus
              </button>
              <p className="text-xs text-gray-400 mt-2">{visibleCount} / {totalFiltered} affichés</p>
            </div>
          )}

          {/* Zéro résultat */}
          {!loading && totalFiltered === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                Aucun professeur trouvé
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                {search.trim() ? `pour « ${search.trim()} »` : 'pour ces critères'}
                {city ? ` à ${city}` : ''}
              </p>

              {/* Actions rapides */}
              <div className="flex flex-wrap gap-2 justify-center mb-6">
                {city && (
                  <button onClick={() => setCity('')} className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition">
                    ✕ Supprimer le filtre ville
                  </button>
                )}
                {level && (
                  <button onClick={() => setLevel('')} className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition">
                    ✕ Supprimer le filtre niveau
                  </button>
                )}
                <button onClick={clearFilters} className="px-4 py-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition">
                  Voir tous les professeurs →
                </button>
              </div>

              {/* Suggérer d'autres matières */}
              {search.trim() && (
                <div className="border-t pt-6">
                  <p className="text-sm text-gray-500 mb-3">Essayez avec une autre matière :</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {SUGGESTED_SUBJECTS.filter(s => s.toLowerCase() !== search.trim().toLowerCase()).slice(0, 5).map(s => (
                      <button
                        key={s}
                        onClick={() => setSearch(s)}
                        className="px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-sm text-gray-700 hover:border-primary hover:text-primary transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA inscription prof */}
              <div className="mt-6 bg-primary/5 border border-primary/10 rounded-xl p-5">
                <p className="text-sm font-semibold text-gray-800 mb-1">
                  Vous enseignez {search.trim() || 'cette matière'} ?
                </p>
                <p className="text-xs text-gray-500 mb-3">Rejoignez EduKaraib et trouvez vos premiers élèves dès aujourd'hui.</p>
                <Link
                  to="/register?role=teacher"
                  className="inline-block bg-primary text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-primary/90 transition"
                >
                  Devenir professeur →
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────
function TeacherCardSkeleton() {
  return (
    <div className="animate-pulse bg-white border border-gray-200 rounded-2xl p-4 flex gap-4 shadow-sm">
      <div className="w-24 h-24 rounded-2xl bg-gray-200 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2 py-1">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
        <div className="h-3 bg-gray-200 rounded w-2/3" />
        <div className="flex gap-2 mt-2">
          <div className="h-6 bg-gray-200 rounded-full w-16" />
          <div className="h-6 bg-gray-200 rounded-full w-20" />
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-2 py-1">
        <div className="h-6 bg-gray-200 rounded w-16" />
        <div className="h-8 bg-gray-200 rounded-xl w-24" />
        <div className="h-8 bg-gray-200 rounded-xl w-24" />
      </div>
    </div>
  );
}

function CertifiedBadge({ className = '' }) {
  return (
    <span title="Prof certifié EduKaraib — plus de 5 avis vérifiés" className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-white text-[10px] font-bold shadow-sm shrink-0 " + className}>
      🏅 Certifié
    </span>
  );
}

function NewProfBadge({ teacher, className = '' }) {
  const raw = teacher.createdAt;
  if (!raw) return null;
  const date = raw?.toDate ? raw.toDate() : new Date((raw?.seconds ?? 0) * 1000);
  if (Date.now() - date.getTime() > 30 * 24 * 60 * 60 * 1000) return null;
  return (
    <span title="Nouveau professeur sur EduKaraib" className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold shadow-sm shrink-0 " + className}>
      ✨ Nouveau
    </span>
  );
}

// ── Carte professeur ─────────────────────────────────────────────────────
function TeacherCard({ teacher, navigate }) {
  const [showContactModal, setShowContactModal] = useState(false);

  const parseLocal = (raw) => {
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const presEnabled  = !!(teacher.presentiel_enabled ?? teacher.presentiel ?? teacher.mode_inperson ?? teacher.in_person);
  const visioEnabled = !!(teacher.visio_enabled ?? teacher.visio ?? teacher.mode_online ?? teacher.online);
  const presBase     = presEnabled  ? parseLocal(teacher.price_per_hour ?? teacher.price) : null;
  const visioRaw     = teacher.visio_same_rate ? (teacher.price_per_hour ?? teacher.price) : teacher.visio_price_per_hour;
  const visioBase    = visioEnabled ? parseLocal(visioRaw) : null;
  const presPrice    = typeof presBase  === 'number' ? presBase  + 10 : null;
  const visioPrice   = typeof visioBase === 'number' ? visioBase + 10 : null;

  const subjectsText = Array.isArray(teacher.subjects)
    ? teacher.subjects.join(', ')
    : (teacher.subjects || teacher.subject || teacher.matiere || 'Matière non précisée');

  const rating       = Number(teacher.avgRating ?? teacher.rating ?? 0);
  const reviewsCount = Number(teacher.reviewsCount ?? teacher.totalReviews ?? 0);

  const handleContact = () => {
    if (auth.currentUser) {
      const uid = teacher.id || teacher.uid;
      if (uid) navigate(`/chat/${uid}`);
    } else {
      setShowContactModal(true);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-4 flex gap-4 relative">
      {showContactModal && (
        <div className="absolute inset-0 z-20 bg-white rounded-2xl flex flex-col items-center justify-center p-6 shadow-xl text-center gap-4">
          <button onClick={() => setShowContactModal(false)} className="absolute top-3 right-4 text-gray-400 hover:text-gray-700 text-xl font-bold">✕</button>
          <div className="text-4xl">💬</div>
          <h4 className="font-extrabold text-gray-900 text-lg leading-snug">
            Contactez {teacher.fullName?.split(' ')[0] || 'ce professeur'} gratuitement
          </h4>
          <p className="text-sm text-gray-600 max-w-[260px]">Créez un compte en 30 secondes pour envoyer un message.</p>
          <button onClick={() => navigate(`/register?express=1&next=/chat/${teacher.id || teacher.uid}`)} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl text-base transition">
            Créer mon compte gratuitement →
          </button>
          <button onClick={() => navigate(`/login?next=/chat/${teacher.id || teacher.uid}`)} className="w-full border border-gray-300 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-50 transition">
            J'ai déjà un compte
          </button>
          <p className="text-xs text-gray-400">✓ Gratuit  ✓ Sans engagement  ✓ En 30 secondes</p>
        </div>
      )}

      <div className="shrink-0">
        <img src={teacher.avatarUrl || '/avatar-default.png'} alt={teacher.fullName || 'Prof'} className="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-cover border border-gray-100" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-lg text-gray-900">{teacher.fullName || 'Professeur'}</h3>
          {reviewsCount >= 5 && <CertifiedBadge />}
          <NewProfBadge teacher={teacher} />
          {rating > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-600 font-semibold">
              ★ {rating.toFixed(1)} <span className="text-gray-400 font-normal">({reviewsCount})</span>
            </span>
          )}
        </div>

        <div className="text-gray-700 text-sm mt-1 font-medium">{subjectsText}</div>
        <div className="text-xs text-gray-500 mt-0.5">{teacher.city || teacher.location || 'Caraïbes'}</div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {visioEnabled && <span className="px-2 py-0.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600">📹 Visio</span>}
          {presEnabled  && <span className="px-2 py-0.5 rounded-full text-xs border border-gray-200 bg-gray-50 text-gray-600">📍 Présentiel</span>}
          {Array.isArray(teacher.teaching_levels) && teacher.teaching_levels.slice(0, 3).map(lv => (
            <span key={lv} className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20">{lv}</span>
          ))}
        </div>

        <p className="mt-2 text-sm text-gray-500 line-clamp-2">{teacher.bio}</p>
      </div>

      <div className="shrink-0 flex flex-col items-end justify-between">
        <div className="text-right">
          {presPrice == null && visioPrice == null ? (
            <span className="text-sm text-amber-700 font-semibold">Prix sur demande</span>
          ) : presPrice != null && visioPrice != null && presPrice !== visioPrice ? (
            <>
              <div className="text-base font-bold text-primary">{presPrice.toFixed(0)} €<span className="text-xs text-gray-500 font-normal"> présentiel</span></div>
              <div className="text-base font-bold text-primary">{visioPrice.toFixed(0)} €<span className="text-xs text-gray-500 font-normal"> visio</span></div>
              <div className="text-xs text-gray-400">/ heure</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-extrabold text-primary">{(presPrice ?? visioPrice).toFixed(0)}<span className="text-sm text-gray-500 font-normal"> €</span></div>
              <div className="text-xs text-gray-400">/ heure</div>
            </>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <Link to={`/profils/${teacher.id}`} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black text-center transition">
            Voir profil
          </Link>
          <button onClick={handleContact} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition">
            Contacter
          </button>
        </div>
      </div>
    </div>
  );
}
