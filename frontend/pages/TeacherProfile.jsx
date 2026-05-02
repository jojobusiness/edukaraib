import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, addDoc, updateDoc,
  serverTimestamp, arrayUnion, onSnapshot, deleteField, runTransaction, increment
} from 'firebase/firestore';
import BookingModal from '../components/BookingModal';
import { useSEO } from '../hooks/useSEO';

const DAYS_ORDER = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function getEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
      const v = u.searchParams.get('v');
      return v ? `https://www.youtube.com/embed/${v}` : null;
    }
    if (u.hostname === 'youtu.be') {
      const v = u.pathname.slice(1);
      return v ? `https://www.youtube.com/embed/${v}` : null;
    }
    if (u.hostname === 'vimeo.com' || u.hostname === 'www.vimeo.com') {
      const v = u.pathname.replace(/^\//, '').split('/')[0];
      return v ? `https://player.vimeo.com/video/${v}` : null;
    }
  } catch { return null; }
  return null;
}

function pickDisplayName(x = {}) {
  return (
    x.fullName || x.full_name || x.name || x.displayName ||
    [x.first_name, x.last_name].filter(Boolean).join(' ') ||
    (x.profile && (x.profile.full_name || x.profile.name)) || ''
  );
}
function pickAvatar(x = {}) {
  return x.avatarUrl || x.avatar_url || x.photoURL || (x.profile && x.profile.avatar) || '';
}
function getReviewerId(r = {}) {
  return r.reviewer_id || r.author_id || r.user_id || r.student_id || r.created_by || null;
}

const mondayOf = (d) => {
  const x = new Date(d);
  const js = x.getDay();           // 0=Dim..6=Sam
  const off = (js + 6) % 7;        // 0=Lun..6=Dim
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - off);
  return x;
};
const weekKeyOf = (d) => mondayOf(d).toISOString().slice(0, 10);

const formatLocalDate = (d) => {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ── Pastille "Prof certifié" (≥ 5 avis) ─────────────────────────────────
function CertifiedBadge({ className = '' }) {
  return (
    <span
      title="Prof certifié EduKaraib — plus de 5 avis vérifiés"
      className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-white text-[10px] font-bold shadow-sm shrink-0 " + className}
    >
      🏅 Certifié
    </span>
  );
}



// ── Bloc avis : mobile = slider horizontal, desktop = 4 max + "Voir plus" ──
function ReviewsBlock({ reviews, reviewerInfo, getReviewerId }) {
  const [showAll, setShowAll] = React.useState(false);
  const DESKTOP_LIMIT = 4;

  if (reviews.length === 0) {
    return (
      <>
        <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">Avis</h2>
        <div className="text-gray-400 text-sm">Aucun avis pour ce professeur.</div>
      </>
    );
  }

  const visibleDesktop = showAll ? reviews : reviews.slice(0, DESKTOP_LIMIT);

  const ReviewCard = ({ r }) => {
    const rid = getReviewerId(r);
    const info = (rid && reviewerInfo[rid]) || {};
    const name = info.name || "Utilisateur";
    const avatar = info.avatar || "/avatar-default.png";
    const rating = r.rating || 0;
    const stars = "★".repeat(Math.min(5, Math.max(0, Math.round(rating))));

    return (
      <div className="bg-gray-50 border rounded-xl px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <img src={avatar} alt={name} className="w-9 h-9 rounded-full object-cover border shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-gray-800 truncate">{name}</span>
            {r.created_at?.toDate && (
              <span className="text-xs text-gray-400">
                {r.created_at.toDate().toLocaleDateString("fr-FR")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-yellow-500 shrink-0">{stars}</span>
          <span className="italic text-gray-700 text-sm">{r.comment}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">
        Avis <span className="text-base font-normal text-slate-400">({reviews.length})</span>
      </h2>

      {/* MOBILE : slider horizontal */}
      <div className="md:hidden -mx-6 px-6 overflow-x-auto pb-3 snap-x snap-mandatory flex gap-3">
        {reviews.map((r) => (
          <div key={r.id} className="snap-start w-[82vw] max-w-[320px]">
            <ReviewCard r={r} />
          </div>
        ))}
      </div>

      {/* DESKTOP : grille 2 colonnes, 4 max + "Voir plus" */}
      <div className="hidden md:block">
        <div className="grid grid-cols-2 gap-3">
          {visibleDesktop.map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
        </div>

        {reviews.length > DESKTOP_LIMIT && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="mt-4 w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-slate-600 hover:bg-gray-50 transition"
          >
            {showAll
              ? "▲ Voir moins"
              : `Voir les ${reviews.length - DESKTOP_LIMIT} autres avis ▼`}
          </button>
        )}
      </div>
    </>
  );
}

export default function TeacherProfile() {
  const { teacherId } = useParams();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewerInfo, setReviewerInfo] = useState({});

  const [bookedSlots, setBookedSlots] = useState([]);
  const [remainingBySlot, setRemainingBySlot] = useState({});

  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [confirmationMsg, setConfirmationMsg] = useState('');

  const [currentRole, setCurrentRole] = useState(null);
  const [children, setChildren] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  const [bookMode, setBookMode] = useState('presentiel');
  const [packChoice, setPackChoice] = useState(0); // 0 = aucun pack, 5, 10
  const [hoursWanted, setHoursWanted] = useState(1); // utilisé seulement si aucun pack

  const [promoCode, setPromoCode] = useState('');
  const [promoOk, setPromoOk] = useState(false);
  const [promoMsg, setPromoMsg] = useState('');

  const [similarTeachers, setSimilarTeachers] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [trialMode, setTrialMode] = useState(false);
  const [trialUsed, setTrialUsed] = useState(false);

  // ✅ Sticky stop propre
  const layoutRef = useRef(null);
  const stickyRef = useRef(null);
  const stopRef = useRef(null);
  const [stickyMode, setStickyMode] = useState('sticky'); // 'sticky' | 'stopped'
  const [stickyTopPx, setStickyTopPx] = useState(0);

  // Charger prof
  useEffect(() => {
    const unsubTeacher = onSnapshot(doc(db, 'users', teacherId), (snap) => {
      if (!snap.exists()) {
        setTeacher(null);
        return;
      }

      const t = { ...snap.data(), id: teacherId };

      const viewerUid = auth.currentUser?.uid;
      if (t.offer_enabled === false && viewerUid !== teacherId) {
        navigate('/search');
        return;
      }

      setTeacher(t);
      setBookMode(t.visio_enabled && !t.presentiel_enabled ? 'visio' : 'presentiel');
    });

    return () => unsubTeacher();
  }, [teacherId, navigate]);

  // Compteur de vues profil (non bloquant, ne compte pas le prof lui-même)
  useEffect(() => {
    if (!teacherId) return;
    const viewerUid = auth.currentUser?.uid;
    if (viewerUid === teacherId) return;
    updateDoc(doc(db, 'users', teacherId), { profileViews: increment(1) }).catch(() => {});
  }, [teacherId]);

  // ✅ Profs similaires (même matière)
  useEffect(() => {
    if (!teacher) return;

    const mainSubjectRaw = teacher.subjects || '';
    const mainSubject = String(mainSubjectRaw).split(',')[0].trim();

    if (!mainSubject) {
      setSimilarTeachers([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingSimilar(true);
      try {
        // 1) On récupère des profs qui ont la même matière (subjects)
        const qTeachers = query(
          collection(db, 'users'),
          where('role', '==', 'teacher'),
          where('subjects', '==', mainSubject)
        );

        const snap = await getDocs(qTeachers);
        const candidates = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.id !== teacherId)
          .filter(t => t.offer_enabled !== false);
        // Limite raisonnable
        const shortlist = candidates.slice(0, 10);

        // 2) Calcul notes/nb avis par prof (client-side, petit volume)
        const withRatings = await Promise.all(
          shortlist.map(async (t) => {
            const qRev = query(collection(db, 'reviews'), where('teacher_id', '==', t.id));
            const revSnap = await getDocs(qRev);
            const ratings = revSnap.docs.map(x => Number(x.data()?.rating || 0)).filter(n => !Number.isNaN(n));
            const count = ratings.length;
            const avg = count ? (ratings.reduce((a, b) => a + b, 0) / count) : 0;

            return { ...t, avgRating: avg, reviewsCount: count };
          })
        );

        // 3) On tri : meilleurs en premier (note puis nb avis)
        withRatings.sort((a, b) => {
          if ((b.avgRating || 0) !== (a.avgRating || 0)) return (b.avgRating || 0) - (a.avgRating || 0);
          return (b.reviewsCount || 0) - (a.reviewsCount || 0);
        });

        if (!cancelled) setSimilarTeachers(withRatings.slice(0, 8));
      } catch (e) {
        console.error('similar teachers error:', e);
        if (!cancelled) setSimilarTeachers([]);
      } finally {
        if (!cancelled) setLoadingSimilar(false);
      }
    })();

    return () => { cancelled = true; };
  }, [teacher, teacherId]);

  const teacherName = teacher
    ? (teacher.fullName || [teacher.firstName, teacher.lastName].filter(Boolean).join(' '))
    : 'Professeur';

  const subjects = Array.isArray(teacher?.subjects)
    ? teacher.subjects.join(', ')
    : teacher?.subjects || '';

  useSEO({
    title: teacher ? `${teacherName} — Prof particulier aux Caraïbes & DOM-TOM` : 'Profil professeur',
    description: teacher
      ? `${teacherName} donne des cours particuliers de ${subjects} aux Caraïbes et dans les DOM-TOM. ${teacher.bio || ''}`
      : 'Profil professeur sur EduKaraib.',
    url: `/prof/${teacherId}`,
    image: teacher?.avatarUrl || undefined,
    jsonLd: teacher ? {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: teacherName,
      jobTitle: 'Professeur particulier',
      image: teacher.avatarUrl || undefined,
      url: `https://edukaraib.com/profils/${teacherId}`,
      description: teacher.bio || '',
      knowsAbout: subjects,
      areaServed: teacher.city || 'Caraïbes & DOM-TOM',
      ...(reviews.length > 0 ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(1),
          reviewCount: reviews.length,
          bestRating: 5,
          worstRating: 1,
        },
      } : {}),
      ...(teacher.price_per_hour ? {
        makesOffer: {
          '@type': 'Offer',
          price: Number(teacher.price_per_hour).toFixed(2),
          priceCurrency: 'EUR',
          description: `Cours particuliers de ${subjects}`,
        },
      } : {}),
    } : undefined,
  });

  // Avis
  useEffect(() => {
    const qReviews = query(collection(db, 'reviews'), where('teacher_id', '==', teacherId));
    const unsub = onSnapshot(qReviews, (snap) => {
      setReviews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [teacherId]);

  // Dispos + infos de réservation
  useEffect(() => {
    if (!teacher) return;

    const qLessons = query(
      collection(db, 'lessons'),
      where('teacher_id', '==', teacherId)
    );

    const unsubLessons = onSnapshot(qLessons, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const booked = [];
      const remaining = {};

      const teacherGroupEnabled = !!teacher.group_enabled;
      const defaultCap =
        teacherGroupEnabled && Number(teacher.group_capacity) > 1
          ? Math.floor(Number(teacher.group_capacity))
          : 1;

      docs.forEach((l) => {
        const day = l.slot_day;
        const hour = l.slot_hour;
        if (!day || typeof hour !== 'number') return;

        // status global de la leçon
        const globalStatus = String(l.status || '').toLowerCase();
        if (['removed', 'deleted', 'rejected'].includes(globalStatus)) return;

        // date locale du cours
        let dateStr = l.date || null;
        if (!dateStr && l.startAt) {
          const d = new Date(l.startAt);
          if (!Number.isNaN(d.getTime())) dateStr = formatLocalDate(d);
        }

        // clé semaine (lundi)
        let weekStr = l.week || null;
        if (!weekStr && dateStr) {
          const d = new Date(`${dateStr}T00:00:00`);
          weekStr = weekKeyOf(d);
        }

        // infos pour BookingModal (isBooked + pastilles enfants)
        booked.push({
          day,
          hour,
          date: dateStr || null,
          week: weekStr || null,
          startAt: l.startAt || null,
          participant_ids: Array.isArray(l.participant_ids) ? l.participant_ids : [],
          student_id: l.student_id || null,
          participantsMap: l.participantsMap || {},
          is_group: !!l.is_group,
          capacity: l.capacity,
          status: l.status,
        });

        // places restantes pour les groupes (par DATE)
        if (l.is_group) {
          const ids = Array.isArray(l.participant_ids) ? l.participant_ids : [];
          const pm = l.participantsMap || {};
          let occupied = 0;
          const uniq = new Set(ids);
          uniq.forEach((sid) => {
            const st = String(pm?.[sid]?.status || l.status || 'pending').toLowerCase();
            if (!['rejected', 'removed', 'deleted'].includes(st)) occupied += 1;
          });

          const cap = Number(l.capacity || 0) > 0 ? Number(l.capacity) : defaultCap;
          const remains = Math.max(0, cap - occupied);

          if (remains > 0) {
            if (dateStr) remaining[`${day}:${hour}:${dateStr}`] = Math.max(remaining[`${day}:${hour}:${dateStr}`] || 0, remains);
            if (weekStr) remaining[`${day}:${hour}:${weekStr}`] = Math.max(remaining[`${day}:${hour}:${weekStr}`] || 0, remains);
            remaining[`${day}:${hour}`] = Math.max(remaining[`${day}:${hour}`] || 0, remains);
          }
        }
      });

      // ➕ capacité par défaut pour les créneaux sans groupe
      const avail = teacher.availability || {};
      const hasWeekKeys = Object.keys(avail).some((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));

      if (!hasWeekKeys) {
        // 🧷 Ancien format : { 'Lun': [9,10], ... }
        Object.entries(avail).forEach(([day, hours]) => {
          (hours || []).forEach((h) => {
            const plainKey = `${day}:${h}`;
            if (remaining[plainKey] == null) remaining[plainKey] = defaultCap;
          });
        });
      } else {
        // 🆕 Nouveau format :
        // { 'YYYY-MM-DD' (lundi): { 'Lun': [9,10], ... }, ... }
        Object.entries(avail).forEach(([weekKey, days]) => {
          if (!days || typeof days !== 'object' || Array.isArray(days)) return;

          Object.entries(days).forEach(([day, hours]) => {
            (hours || []).forEach((h) => {
              const plainKey = `${day}:${h}`;
              const weekK = `${day}:${h}:${weekKey}`;
              if (remaining[plainKey] == null) remaining[plainKey] = defaultCap;
              if (remaining[weekK] == null) remaining[weekK] = defaultCap;
            });
          });
        });
      }

      setBookedSlots(booked);
      setRemainingBySlot(remaining);
    });

    return () => unsubLessons();
  }, [teacherId, teacher]);

  // Infos auteurs d'avis
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(
        new Set(reviews.map((r) => getReviewerId(r)).filter(Boolean))
      ).filter((id) => !(id in reviewerInfo));

      if (ids.length === 0) return;

      const entries = await Promise.all(ids.map(async (id) => {
        try {
          const u = await getDoc(doc(db, 'users', id));
          if (u.exists()) {
            const ux = u.data();
            return [id, { name: pickDisplayName(ux) || 'Utilisateur', avatar: pickAvatar(ux) || '' }];
          }
        } catch {}
        try {
          const s = await getDoc(doc(db, 'students', id));
          if (s.exists()) {
            const sx = s.data();
            return [id, { name: pickDisplayName(sx) || 'Élève', avatar: pickAvatar(sx) || '' }];
          }
        } catch {}
        return [id, { name: 'Utilisateur', avatar: '' }];
      }));

      if (!cancelled) {
        setReviewerInfo((prev) => {
          const next = { ...prev };
          entries.forEach(([id, val]) => { next[id] = val; });
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [reviews]); // eslint-disable-line

  // Rôle courant + enfants
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = auth.currentUser;
      if (!me) return;

      // <<< AJOUT : variable partagée pour retenir le rôle lu >>>
      let computedRole = null;

      try {
        const meSnap = await getDoc(doc(db, 'users', me.uid));
        const role = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(role || null);
        computedRole = meSnap.exists() ? meSnap.data()?.role : null;
        if (!cancelled) setCurrentRole(computedRole || null);
        const usedWith = meSnap.exists() ? (meSnap.data()?.trialUsedWith || []) : [];
        if (!cancelled) setTrialUsed(usedWith.includes(teacherId));
      } catch { if (!cancelled) setCurrentRole(null); }

      try {
        const kidsQ = query(collection(db, 'students'), where('parent_id', '==', me.uid));
        const kidsSnap = await getDocs(kidsQ);
        const kids = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!cancelled) setChildren(kids);

        // ➕ Sélection par défaut PLUS INTELLIGENTE pour les parents :
        if (!cancelled) {
          setSelectedStudentId((prev) => {
            // <<< on utilise computedRole, PAS "role" >>>
            if ((computedRole || null) === 'parent' && kids.length > 0) return kids[0].id;
            return prev || me.uid;
          });
        }
      } catch {
        if (!cancelled) setSelectedStudentId((prev) => prev || me.uid);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ✅ Sticky stop "propre" avec IntersectionObserver (et recalcul sur resize)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)'); // lg+
    const TOP_OFFSET = 24; // top-6
    let observer = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const computeStop = () => {
      if (!mq.matches) {
        setStickyMode('sticky');
        setStickyTopPx(0);
        return;
      }
      const layoutEl = layoutRef.current;
      const stickyEl = stickyRef.current;
      const stopEl = stopRef.current;
      if (!layoutEl || !stickyEl || !stopEl) return;

      const layoutTop = layoutEl.getBoundingClientRect().top + window.scrollY;
      const stopTop = stopEl.getBoundingClientRect().top + window.scrollY;
      const stickyHeight = stickyEl.offsetHeight;

      const maxScrollTop = stopTop - stickyHeight - TOP_OFFSET;

      if (window.scrollY >= maxScrollTop) {
        setStickyMode('stopped');
        setStickyTopPx(maxScrollTop - layoutTop);
      } else {
        setStickyMode('sticky');
        setStickyTopPx(0);
      }
    };

    const setup = () => {
      cleanup();
      computeStop();

      if (!mq.matches) return;

      const stickyEl = stickyRef.current;
      const stopEl = stopRef.current;
      if (!stickyEl || !stopEl) return;

      const stickyHeight = stickyEl.offsetHeight;

      observer = new IntersectionObserver(
        () => computeStop(),
        {
          root: null,
          threshold: 0,
          // quand "profs similaires" arrive au niveau du bas de la sticky
          rootMargin: `-${TOP_OFFSET + stickyHeight}px 0px 0px 0px`,
        }
      );

      observer.observe(stopEl);
    };

    setup();
    window.addEventListener('scroll', computeStop, { passive: true });
    window.addEventListener('resize', setup);
    mq.addEventListener?.('change', setup);

    return () => {
      cleanup();
      window.removeEventListener('scroll', computeStop);
      window.removeEventListener('resize', setup);
      mq.removeEventListener?.('change', setup);
    };
  }, []);

  // --- guards / helpers ---
  const meUid = auth.currentUser?.uid;
  const isTeacherUser = currentRole === 'teacher';
  const isOwnProfile = teacherId === auth.currentUser?.uid;
  const canBook = !isTeacherUser && !isOwnProfile;

  const safeTeacher = teacher || {};

  const effectiveVisioPrice = (t) => {
    if (!t?.visio_enabled) return null;
    return t.visio_same_rate ? Number(t.price_per_hour || 0) : Number(t.visio_price_per_hour || 0);
  };
  const pack5Display = (t) => {
    const base = Number(t?.price_per_hour || 0);
    const v = t?.pack5_price;
    return (v !== undefined && v !== '' && v !== null)
      ? Number(v)
      : (base > 0 ? Number((5 * base * 0.9).toFixed(2)) : null);
  };
  const pack10Display = (t) => {
    const base = Number(t?.price_per_hour || 0);
    const v = t?.pack10_price;
    return (v !== undefined && v !== '' && v !== null)
      ? Number(v)
      : (base > 0 ? Number((10 * base * 0.9).toFixed(2)) : null);
  };

  // ⭐ Notes / nb avis
  const ratings = reviews.map(r => Number(r.rating || 0)).filter(n => !Number.isNaN(n));
  const reviewsCount = ratings.length;
  const avgRating = reviewsCount ? (ratings.reduce((a, b) => a + b, 0) / reviewsCount) : 0;

  // 👥 nb élèves uniques (depuis lessons)
  const uniqueStudentsCount = useMemo(() => {
    const ids = new Set();
    bookedSlots.forEach(l => {
      const sid = l.student_id;
      if (sid) ids.add(sid);
      const arr = Array.isArray(l.participant_ids) ? l.participant_ids : [];
      arr.forEach(x => x && ids.add(x));
    });
    return ids.size;
  }, [bookedSlots]);

  // 🔸 image promo (mets le chemin correct dans /public)
  const PROMO_BANNER_SRC = "/promo/packs-guyane.png";

  // ✅ IMPORTANT : on ne calcule les labels/modes qu'avec safeTeacher (jamais teacher direct)
  const modeLabel =
    safeTeacher.presentiel_enabled && safeTeacher.visio_enabled
      ? "Présentiel + Visio"
      : safeTeacher.visio_enabled
        ? "Visio"
        : safeTeacher.presentiel_enabled
          ? "Présentiel"
          : "Mode non précisé";

  const basePrice = Number(safeTeacher?.price_per_hour || 0);
  const visioPrice = effectiveVisioPrice(safeTeacher);
  const p5 = pack5Display(safeTeacher);
  const p10 = pack10Display(safeTeacher);

  // (tu avais des +10/+50/+100 : je les garde comme dans ton code)
  const displayHourPresentiel = Number.isFinite(basePrice) ? basePrice + 10 : null;
  const effectiveVisio = (visioPrice ?? basePrice);
  const displayHourVisio = safeTeacher?.visio_enabled ? (effectiveVisio + 10) : null;

  const displayPack5Presentiel = p5 != null ? p5 + 50 : null;
  const displayPack10Presentiel = p10 != null ? p10 + 100 : null;

  const computePack = (rate, hours) => (rate > 0 ? Number((hours * rate * 0.9).toFixed(2)) : null);
  const p5VisioRaw = safeTeacher?.visio_enabled ? computePack(effectiveVisio, 5) : null;
  const p10VisioRaw = safeTeacher?.visio_enabled ? computePack(effectiveVisio, 10) : null;

  const displayPack5Visio = p5VisioRaw != null ? p5VisioRaw + 50 : null;
  const displayPack10Visio = p10VisioRaw != null ? p10VisioRaw + 100 : null;

  const presentielOnly = !!safeTeacher?.presentiel_enabled && !safeTeacher?.visio_enabled;
  const visioOnly = !!safeTeacher?.visio_enabled && !safeTeacher?.presentiel_enabled;
  const onlyMode = presentielOnly ? 'presentiel' : (visioOnly ? 'visio' : null);

  useEffect(() => {
    if (packChoice !== 5) setPromoOk(false);
  }, [packChoice]);

  const checkPromo = async () => {
    const me = auth.currentUser;
    const code = promoCode.trim().toUpperCase();

    if (!me) { setPromoOk(false); setPromoMsg('Connecte-toi pour utiliser un code.'); return; }
    if (packChoice !== 5) { setPromoOk(false); setPromoMsg('Ce code promo est valable uniquement sur le pack 5h.'); return; }
    if (!code) { setPromoOk(false); setPromoMsg(''); return; }

    const snap = await getDoc(doc(db, 'promo_codes', code));
    if (!snap.exists()) { setPromoOk(false); setPromoMsg('Code invalide.'); return; }

    const p = snap.data() || {};
    if (p.owner_id !== me.uid) { setPromoOk(false); setPromoMsg("Ce code ne t'appartient pas."); return; }
    if (String(p.status || '').toLowerCase() !== 'active') { setPromoOk(false); setPromoMsg('Code déjà utilisé ou expiré.'); return; }
    if (Number(p.eligible_pack_hours || 0) !== 5) { setPromoOk(false); setPromoMsg('Ce code ne fonctionne pas sur ce pack.'); return; }

    setPromoOk(true);
    setPromoMsg('✅ Code activé : +1h offerte en plus sur le pack 5h.');
  };

  // Pack bonus existant + bonus promo en plus
  const baseBonusHours = packChoice === 5 ? 1 : packChoice === 10 ? 2 : 0;
  const promoBonusHours = (packChoice === 5 && promoOk) ? 1 : 0;
  const freeCount = baseBonusHours + promoBonusHours;

  const requiredCount =
    packChoice === 5 ? (5 + freeCount)
    : packChoice === 10 ? (10 + freeCount)
    : Math.max(1, Number(hoursWanted) || 1);
    
  // ✅ GARDE : tant que teacher n'est pas chargé
  if (!teacher) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-5xl mx-auto animate-pulse">
          <div className="bg-white rounded-2xl shadow p-6 flex gap-6 mb-6">
            <div className="w-24 h-24 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="h-6 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded w-1/4" />
              <div className="flex gap-2 mt-2">
                <div className="h-6 bg-gray-200 rounded-full w-20" />
                <div className="h-6 bg-gray-200 rounded-full w-20" />
              </div>
            </div>
            <div className="shrink-0 space-y-2">
              <div className="h-6 bg-gray-200 rounded w-24" />
              <div className="h-10 bg-gray-200 rounded-xl w-32" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow p-6 space-y-3">
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  // ---------------- BOOKING HANDLER (inchangé chez toi, je ne le recasse pas) ----------------
  const handleBooking = async (selected) => {
    if (!auth.currentUser) return navigate('/login');
    if (!canBook) {
      setShowBooking(false);
      setConfirmationMsg("Les comptes professeurs ne peuvent pas réserver de cours.");
      return;
    }

    const me = auth.currentUser;
    const targetStudentId = selectedStudentId || me.uid;
    const bookingFor =
      currentRole === "parent" && targetStudentId !== me.uid ? "child" : "self";
    const slots = Array.isArray(selected) ? selected : [selected];

    const isPack = packChoice === 5 || packChoice === 10;
    const paidHours = packChoice; // 5 ou 10
    const packType = paidHours === 5 ? "pack5" : paidHours === 10 ? "pack10" : null;

    // ✅ bonus pack existant + bonus promo
    const baseBonusHours = packChoice === 5 ? 1 : packChoice === 10 ? 2 : 0;
    const promoBonusHours = (packChoice === 5 && promoOk) ? 1 : 0;
    const bonusHours = baseBonusHours + promoBonusHours;

    // ✅ total créneaux à créer pour le pack
    const totalPackHours = isPack ? (paidHours + bonusHours) : 0;


    // 1 seul pack_id pour tout (root + participant)*
    const forcedPackId = isPack
      ? `${auth.currentUser.uid}_${teacherId}_${Date.now()}_${paidHours}_${bookMode}`
      : null;
    
    // --- helpers pack (au NIVEAU PARTICIPANT) ---
    const wipePackParticipant = (sid) => ({
      [`participantsMap.${sid}.pack`]: deleteField(),
      [`participantsMap.${sid}.is_pack`]: deleteField(),
      [`participantsMap.${sid}.pack_id`]: deleteField(),
      [`participantsMap.${sid}.pack_type`]: deleteField(),
      [`participantsMap.${sid}.pack_mode`]: deleteField(),
      [`participantsMap.${sid}.pack_hours`]: deleteField(),
      [`participantsMap.${sid}.pack_hours_total`]: deleteField(),
      [`participantsMap.${sid}.pack_hours_remaining`]: deleteField(),
      [`participantsMap.${sid}.require_accept_all`]: deleteField(),
    });

    // Poser un pack propre pour un participant
    const putPackParticipant = (sid, hours, mode, forcedPackId) => {
      if (!(hours === 5 || hours === 10)) return {};
      return {
        [`participantsMap.${sid}.pack`]: true,
        [`participantsMap.${sid}.pack_id`]: forcedPackId || `${auth.currentUser.uid}_${teacherId}_${Date.now()}_${hours}_${mode}`,
        [`participantsMap.${sid}.pack_type`]: (hours === 5 ? 'pack5' : 'pack10'),
        [`participantsMap.${sid}.pack_mode`]: mode,
        [`participantsMap.${sid}.pack_hours`]: hours,
        [`participantsMap.${sid}.require_accept_all`]: true,
      };
    };

    const putPackRoot = (forcedPackId) => {
      if (!isPack) return {};
      const pid = forcedPackId || `${auth.currentUser.uid}_${teacherId}_${Date.now()}_${paidHours}_${bookMode}`;
      return {
        pack: true,
        pack_id: pid,
        pack_type: packType,
        pack_mode: bookMode,
        pack_hours: paidHours,
        pack_bonus_hours: bonusHours,
        pack_hours_total: totalPackHours,
        pack_hours_remaining: totalPackHours, // au départ
        require_accept_all: true,
      };
    };

    const base = Number(teacher?.price_per_hour || 0);
    const visio = effectiveVisioPrice(teacher);
    const hourly =
      bookMode === "visio" && visio !== null ? visio : base;

    setIsBooking(true);
    setConfirmationMsg("");
    try {
      const results = [];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const isFree = trialMode ? true : (isPack && i < bonusHours);
        const freeReason = trialMode ? 'trial'
          : (isFree ? (i < baseBonusHours ? "pack_bonus" : "first_review_promo") : null);
          
        try {
          // Vérifier doublons + réactiver si précédemment "rejected"
          const dupIndQ = query(
            collection(db, "lessons"),
            where("teacher_id", "==", teacherId),
            where("slot_day", "==", slot.day),
            where("slot_hour", "==", slot.hour),
            where("date", "==", slot.date),          // 🔸 différence de semaine
            where("is_group", "==", false),
            where("student_id", "==", targetStudentId)
          );
          const dupGrpQ = query(
            collection(db, "lessons"),
            where("teacher_id", "==", teacherId),
            where("slot_day", "==", slot.day),
            where("slot_hour", "==", slot.hour),
            where("date", "==", slot.date),
            where("is_group", "==", true),
            where("participant_ids", "array-contains", targetStudentId)
          );

          const [dupIndSnap, dupGrpSnap] = await Promise.all([getDocs(dupIndQ), getDocs(dupGrpQ)]);

          // 1) INDIVIDUEL : s'il existe un cours non rejeté -> DUPLICATE
          const existingInd = dupIndSnap.docs[0]?.data();
          const existingIndId = dupIndSnap.docs[0]?.id;

          if (existingInd) {
            // 🔎 Regarder d'abord le statut du PARTICIPANT visé
            const partSt = String(
              existingInd?.participantsMap?.[targetStudentId]?.status ||
              existingInd?.status || ''
            ).toLowerCase();

            // S'il est encore actif (pas rejeté/supprimé) ⇒ c'est bien un doublon
            if (!['rejected', 'removed', 'deleted'].includes(partSt)) {
              results.push({ slot, status: 'duplicate', message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
              continue;
            }

            // 💡 "Réactiver" l'ancien individuel rejeté pour CET élève, sans pack si wantSingle
            await updateDoc(doc(db, 'lessons', existingIndId), {
              status: 'booked',
              student_id: targetStudentId,
              date: slot.date,
              week: slot.week,
              startAt: new Date(slot.startAt),
              // sécurité : enlever tout vieux champ pack posé par le passé AU NIVEAU LEÇON
              is_pack: deleteField(),
              pack_hours: deleteField(),
              pack_type: deleteField(),
              pack_mode: deleteField(),
              pack_hours_total: deleteField(),
              pack_hours_remaining: deleteField(),

              pack: deleteField(),
              pack_id: deleteField(),
              pack_bonus_hours: deleteField(),
              require_accept_all: deleteField(),

              participant_ids: Array.from(new Set([...(existingInd.participant_ids || []), targetStudentId])),

              // on repart sur une demande "unitaire" => on efface tout Pack du participant
              ...wipePackParticipant(targetStudentId),

              [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
              [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
              [`participantsMap.${targetStudentId}.is_paid`]: false,
              [`participantsMap.${targetStudentId}.paid_by`]: null,
              [`participantsMap.${targetStudentId}.paid_at`]: null,
              [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
              [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),

              ...(isPack
                ? putPackParticipant(targetStudentId, paidHours, bookMode, forcedPackId)
                : wipePackParticipant(targetStudentId)
              ),
            });

            await addDoc(collection(db, 'notifications'), {
              user_id: teacherId,
              read: false,
              created_at: serverTimestamp(),
              type: 'lesson_request',
              lesson_id: existingIndId,
              requester_id: targetStudentId,
              message: `Relance de demande (individuel) ${slot.day} ${slot.hour}h.`,
            });

            results.push({ slot, status: 'revived_individual', message: `Demande réactivée (individuel) ${slot.day} ${slot.hour}h.` });
            continue;
          }

          // 2) GROUPE : s'il existe un groupe où je suis déjà "actif" -> DUPLICATE
          let alreadyActiveInGroup = false;
          let rejectedInGroupDoc = null;

          for (const d of dupGrpSnap.docs) {
            const g = d.data();
            const pm = g.participantsMap || {};
            const pst = String(pm?.[targetStudentId]?.status || "pending").toLowerCase();
            if (!["rejected", "removed", "deleted"].includes(pst)) {
              // actif (pending/accepted/confirmed) -> duplicate
              alreadyActiveInGroup = true;
              break;
            }
            if (["rejected", "removed", "deleted"].includes(pst)) {
              rejectedInGroupDoc = { id: d.id, data: g };
              // on ne break pas ici : on préfère d'abord vérifier s'il y a un actif
            }
          }

          if (alreadyActiveInGroup) {
            results.push({ slot, status: "duplicate", message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
            continue;
          }

          //    b) groupe où je suis "rejected" -> passer ce participant en pending_teacher
          if (rejectedInGroupDoc) {
            const { id: gId, data: g } = rejectedInGroupDoc;
            const wantSingle = !(packChoice === 5 || packChoice === 10);

            const basePayload = {
              participant_ids: Array.from(new Set([...(g.participant_ids || []), targetStudentId])),
              [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
              [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
              [`participantsMap.${targetStudentId}.is_paid`]: false,
              [`participantsMap.${targetStudentId}.paid_by`]: null,
              [`participantsMap.${targetStudentId}.paid_at`]: null,
              [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
              [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),
            };

            await updateDoc(doc(db, 'lessons', gId), {
              ...basePayload,
              ...(isPack
                ? putPackParticipant(targetStudentId, paidHours, bookMode, forcedPackId)
                : wipePackParticipant(targetStudentId)
              ),
            });

            await addDoc(collection(db, "notifications"), {
              user_id: teacherId,
              read: false,
              created_at: serverTimestamp(),
              type: "lesson_request",
              lesson_id: gId,
              requester_id: targetStudentId,
              message: `Relance de demande (groupe) ${slot.day} ${slot.hour}h.`,
            });

            results.push({ slot, status: "revived_group", message: `Demande réactivée (groupe) ${slot.day} ${slot.hour}h.` });
            continue;
          }

          // 4) Si pas de réactivation possible : logique précédente
          // Rejoindre un groupe existant (packs autorisés aussi)
          {
            const qExisting = query(
              collection(db, "lessons"),
              where("teacher_id", "==", teacherId),
              where("slot_day", "==", slot.day),
              where("slot_hour", "==", slot.hour),
              where("date", "==", slot.date),
              where("is_group", "==", true)
            );
            const existSnap = await getDocs(qExisting);
            let joined = false;

            for (const d of existSnap.docs) {
              const l = d.data();
              const current = Array.isArray(l.participant_ids) ? l.participant_ids : [];
              if (current.includes(targetStudentId)) {
                results.push({ slot, status: "duplicate", message: `Déjà inscrit(e) sur ${slot.day} ${slot.hour}h.` });
                joined = true;
                break;
              }

              await updateDoc(doc(db, 'lessons', d.id), {
                participant_ids: arrayUnion(targetStudentId),

                // infos communes
                [`participantsMap.${targetStudentId}.parent_id`]: (bookingFor === 'child' ? me.uid : null),
                [`participantsMap.${targetStudentId}.booked_by`]: me.uid,
                [`participantsMap.${targetStudentId}.is_paid`]: false,
                [`participantsMap.${targetStudentId}.paid_by`]: null,
                [`participantsMap.${targetStudentId}.paid_at`]: null,
                [`participantsMap.${targetStudentId}.status`]: 'pending_teacher',
                [`participantsMap.${targetStudentId}.added_at`]: serverTimestamp(),

                ...(isPack
                  ? putPackParticipant(targetStudentId, paidHours, bookMode, forcedPackId)
                  : wipePackParticipant(targetStudentId)
                ),
              });

              await addDoc(collection(db, "notifications"), {
                user_id: teacherId,
                read: false,
                created_at: serverTimestamp(),
                type: "lesson_request",
                lesson_id: d.id,
                requester_id: targetStudentId,
                message: `Demande d'ajout au groupe (${slot.day} ${slot.hour}h).`,
              });

              results.push({ slot, status: "joined_group", message: `Ajout au groupe demandé pour ${slot.day} ${slot.hour}h.` });
              joined = true;
              break;
            }
            if (joined) continue;
          }

          // Création (groupe / individuel)
          const groupEnabled = !!teacher?.group_enabled;
          const teacherCap = Number(teacher?.group_capacity || 1);
          const defaultCap = teacherCap > 1 ? teacherCap : 1;
          const allowGroup = groupEnabled && defaultCap > 1;
          const createAsGroup = allowGroup;

          const newLessonRef = await addDoc(collection(db, 'lessons'), {
            teacher_id: teacherId,
            status: 'booked',
            created_at: serverTimestamp(),
            subject_id: Array.isArray(teacher?.subjects) ? teacher.subjects.join(', ') : (teacher?.subjects || ''),
            price_per_hour: trialMode ? 0 : (hourly || 0),
            slot_day: slot.day,
            slot_hour: slot.hour,
            date: slot.date,
            week: slot.week,
            startAt: slot.startAt,
            is_group: createAsGroup,
            capacity: createAsGroup ? defaultCap : 1,
            student_id: createAsGroup ? null : targetStudentId,
            is_free_hour: isFree,
            free_reason: freeReason,
            ...(trialMode ? { is_trial: true } : {}),

            participant_ids: [targetStudentId],
            participantsMap: {
              [targetStudentId]: {
                parent_id: (bookingFor === 'child' ? me.uid : null),
                booked_by: me.uid,
                is_paid: trialMode ? true : false,
                paid_by: trialMode ? 'trial' : null,
                paid_at: trialMode ? serverTimestamp() : null,
                is_free_hour: isFree,
                free_reason: freeReason,
                status: 'pending_teacher',
                added_at: serverTimestamp(),
              },
            },

            mode: bookMode,
            ...(isPack ? putPackRoot(forcedPackId) : {}), // ✅ fix: s'applique aussi aux cours groupés
          });

          // Pose/Nettoie le pack APRES création (pour ne pas polluer la leçon)
          await updateDoc(doc(db, 'lessons', newLessonRef.id), {
            ...(isPack
              ? putPackParticipant(targetStudentId, paidHours, bookMode, forcedPackId)
              : wipePackParticipant(targetStudentId)
            ),
          });

          // Optionnel: notif prof (garde ta version si tu en as déjà une)
          await addDoc(collection(db, 'notifications'), {
            user_id: teacherId,
            read: false,
            created_at: serverTimestamp(),
            type: 'lesson_request',
            lesson_id: newLessonRef.id,
            requester_id: targetStudentId,
            message: trialMode
              ? `Demande d'essai gratuit (${slot.day} ${slot.hour}h).`
              : `Demande de cours ${createAsGroup ? 'groupé' : 'individuel'} (${slot.day} ${slot.hour}h).`,
          });

          // Pour ton feedback UI local
          results.push({
            slot,
            status: createAsGroup ? 'created_group' : 'created_individual',
            message: trialMode
              ? `Essai gratuit demandé pour ${slot.day} ${slot.hour}h.`
              : `Demande de cours ${createAsGroup ? 'groupé' : 'individuel'} pour ${slot.day} ${slot.hour}h.`,
          });
        } catch (e) {
          console.error("Booking error (single)", e);
          results.push({
            slot,
            status: "error",
            message: `Erreur sur ${slot.day} ${slot.hour}h.`,
          });
        }
      }

      const grouped = {
        created_group: [],
        created_individual: [],
        joined_group: [],
        duplicate: [],
        error: [],
      };
      for (const r of results) {
        const key = grouped[r.status] ? r.status : "error";
        grouped[key].push(`${r.slot.day} ${r.slot.hour}h`);
      }

      const parts = [];
      if (grouped.created_individual.length)
        parts.push(
          `Demandes individuelles envoyées : ${grouped.created_individual.join(", ")}.`
        );
      if (grouped.created_group.length)
        parts.push(
          `Demandes de création de groupe envoyées : ${grouped.created_group.join(", ")}.`
        );
      if (grouped.joined_group.length)
        parts.push(
          `Demandes d'ajout à un groupe envoyées : ${grouped.joined_group.join(", ")}.`
        );
      if (grouped.duplicate.length)
        parts.push(`Déjà inscrit(e) sur : ${grouped.duplicate.join(", ")}.`);
      if (grouped.error.length)
        parts.push(`Erreurs sur : ${grouped.error.join(", ")}.`);

      // Si on vient de "réactiver" un refus en unitaire => coupe l'état UI du pack
      if (isPack && results.some(r => r.status === 'revived_individual' || r.status === 'revived_group')) {
        setPackChoice(0);  // plus d'étiquette Pack dans la confirmation
      }


      setShowBooking(false);

      const onlyOk = results.filter(r => r.status !== 'error');
      const hasOk  = onlyOk.length > 0;

      if (trialMode && hasOk) {
        setTrialUsed(true);
        setTrialMode(false);
        try {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            trialUsedWith: arrayUnion(teacherId),
          });
        } catch {}
      }

      setConfirmationMsg(
        hasOk
          ? parts.join(' ')
          : "Erreur lors de la réservation. Réessayez plus tard."
      );
    } catch (e) {
      console.error("Booking error (batch)", e);
      setConfirmationMsg("Erreur lors de la réservation. Réessayez plus tard.");
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white">
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <div className="hidden lg:block max-w-6xl mx-auto px-4 pt-6">
          <button
            type="button"
            onClick={() => navigate('/search')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            <span className="text-lg">←</span>
            Retour à la recherche
          </button>
        </div>
      </div>
      <div
        ref={layoutRef}
        className="max-w-6xl mx-auto px-0 lg:px-4 py-0 lg:py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative"
      >

        {/* COLONNE GAUCHE (CONTENU)  */}
        <main className="lg:col-span-8 space-y-8">
          {/* ===== HERO + CARD (MOBILE) ===== */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => navigate('/search')}
              className="absolute top-3 left-3 z-20 w-10 h-10 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-900"
              aria-label="Retour"
            >
              ←
            </button>
            {/* Image prof (dans la page) */}
            <div className="relative w-full">
              <img
                src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || "/avatar-default.png"}
                alt={teacher.fullName || "Prof"}
                className="w-full h-[70vh] min-h-[420px] max-h-[560px] object-cover block rounded-b-3xl"
              />

              {/* badge mode dans l'image */}
              <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full text-xs font-bold bg-black/65 text-white">
                {modeLabel}
              </div>
            </div>

            {/* Carte qui remonte sur l'image (Superprof-like) */}
            <div className="-mt-24 px-4 pb-6 relative z-10">
              <div className="bg-white border border-gray-100 rounded-2xl shadow-lg p-5">
                <div className="text-2xl font-extrabold text-slate-900 leading-tight">
                  {teacher.firstName || ""} {teacher.lastName || teacher.fullName || "Professeur"}
                </div>

                {/* étoiles + avis + badge certifié */}
                <div className="mt-2 flex items-center flex-wrap gap-2 text-sm">
                  <span className="text-yellow-500">
                    {"★".repeat(Math.round(avgRating || 0)).padEnd(5, "☆")}
                  </span>
                  <span className="text-slate-700 font-semibold">
                    {avgRating ? avgRating.toFixed(1) : "0.0"}
                  </span>
                  <span className="text-slate-500">({reviewsCount} avis)</span>
                  {reviewsCount >= 5 && <CertifiedBadge />}
                </div>

                {/* Tarifs à l'heure (visio/presentiel) */}
                <div className="mt-2 text-sm text-slate-700">
                  {teacher.presentiel_enabled && (
                    <div>
                      Présentiel :{" "}
                      <span className="font-extrabold">
                        {displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(2)} € / h` : "—"}
                      </span>
                    </div>
                  )}
                  {teacher.visio_enabled && (
                    <div>
                      Visio :{" "}
                      <span className="font-extrabold">
                        {displayHourVisio != null ? `${displayHourVisio.toFixed(2)} € / h` : "—"}
                      </span>
                    </div>
                  )}
                </div>

                {/* nb élèves — désactivé temporairement */}
                {/* <div className="mt-2 text-sm text-slate-600">
                  {uniqueStudentsCount} élève{uniqueStudentsCount > 1 ? "s" : ""} a déjà pris un cours avec ce professeur
                </div> */}

                {/* Bouton contacter */}
                {!isOwnProfile && (
                  <button
                    className="mt-4 w-full bg-yellow-400 text-slate-900 px-5 py-3 rounded-xl font-semibold shadow hover:bg-yellow-500 transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      navigate(`/chat/${teacherId}`);
                    }}
                  >
                    Contacter le professeur
                  </button>
                )}

                {/* Parent : choix enfant (MOBILE) */}
                {currentRole === "parent" && (
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Qui est l'élève ?
                    </label>

                    <select
                      className="w-full border rounded-xl px-3 py-2 bg-white"
                      value={selectedStudentId || meUid || ""}
                      onChange={(e) => setSelectedStudentId(e.target.value)}
                    >
                      {meUid && <option value={meUid}>Moi (parent)</option>}
                      {children.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.full_name || k.fullName || k.name || "Enfant"}
                        </option>
                      ))}
                    </select>

                    <p className="mt-2 text-xs text-slate-500">
                      Les créneaux en rouge sont indisponibles pour l'élève sélectionné.
                    </p>
                  </div>
                )}

                {/* Sélecteurs côte à côte */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Mode</label>
                    {onlyMode ? (
                      <div className="w-full border rounded-xl px-3 py-2 bg-gray-50 text-slate-800 font-semibold text-sm">
                        {onlyMode === "visio" ? "Visio" : "Présentiel"}
                      </div>
                    ) : (
                      <select
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={bookMode}
                        onChange={(e) => setBookMode(e.target.value)}
                      >
                        <option value="presentiel">Présentiel</option>
                        {teacher.visio_enabled && <option value="visio">Visio</option>}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Pack</label>
                    <select
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={packChoice}
                      onChange={(e) => setPackChoice(Number(e.target.value))}
                    >
                      <option value={0}>Aucun pack</option>
                      <option value={5}>Pack 5h (+{promoOk ? 2 : 1}h offerte{promoOk ? 's' : ''})</option>
                      <option value={10}>Pack 10h (+2h offertes)</option>
                    </select>
                  </div>
                </div>
                
                {packChoice === 5 && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Code promo</label>
                    <div className="flex gap-2">
                      <input
                        value={promoCode}
                        onChange={(e) => { setPromoCode(e.target.value); setPromoOk(false); setPromoMsg(''); }}
                        className="flex-1 border rounded-xl px-3 py-2 text-sm"
                        placeholder="Ex: AVIS-9F3K2Q"
                      />
                      <button
                        type="button"
                        onClick={checkPromo}
                        className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"
                      >
                        Appliquer
                      </button>
                    </div>
                    {promoMsg && <div className="mt-2 text-[11px] text-slate-600">{promoMsg}</div>}
                  </div>
                )}

                {packChoice === 0 && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Nombre d'heures
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={hoursWanted}
                      onChange={(e) => setHoursWanted(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                      placeholder="Ex: 3"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Vous devrez sélectionner exactement {hoursWanted} créneau(x).
                    </p>
                  </div>
                )}

                {/* Réserver */}
                {(!isTeacherUser && !isOwnProfile) && (
                  <button
                    className="mt-4 w-full bg-primary text-white px-5 py-3 rounded-xl font-semibold shadow hover:bg-primary-dark transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      setTrialMode(false);
                      setShowBooking(true);
                      setConfirmationMsg("");
                    }}
                  >
                    {isBooking ? "Envoi…" : "Réserver"}
                  </button>
                )}

                {/* Essai gratuit */}
                {(!isTeacherUser && !isOwnProfile) && teacher.trial_enabled === true && (
                  <button
                    disabled={trialUsed}
                    className={`mt-2 w-full px-5 py-3 rounded-xl font-semibold shadow transition ${
                      trialUsed
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      if (trialUsed) return;
                      setTrialMode(true);
                      setPackChoice(0);
                      setHoursWanted(1);
                      setShowBooking(true);
                      setConfirmationMsg("");
                    }}
                  >
                    {trialUsed ? "Essai gratuit dejà utilisé" : "Essai gratuit (1h)"}
                  </button>
                )}

                {confirmationMsg && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm">
                    {confirmationMsg}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Image promo (à côté de la carte sticky, sans empiéter) */}
          <div className="w-full">
            <img
              src={PROMO_BANNER_SRC}
              alt="Offre packs"
              className="w-full rounded-2xl border border-gray-100 shadow-sm object-cover"
            />

            {/* Bio (grande, très visible) */}
            <div className="mt-4">
              <div className="text-xl md:text-2xl font-extrabold text-slate-900 leading-snug">
                {teacher.bio || teacher.about_me || "Le professeur n'a pas encore ajouté de bio."}
              </div>
            </div>

            {/* Localisation sous l'image (bulle + icône, texte plus grand) */}
            <div className="mt-4 flex justify-center sm:justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-3 shadow-sm">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-slate-700"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 21s7-4.35 7-11a7 7 0 10-14 0c0 6.65 7 11 7 11z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 10a2 2 0 100-4 2 2 0 000 4z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>

                <span className="text-base md:text-lg font-semibold text-slate-900">
                  Chez {teacher.firstName || teacher.fullName || "le prof"} :{" "}
                  {teacher.city || teacher.location || "Localisation non précisée"}
                </span>
              </div>
            </div>
          </div>

          {/* À propos de moi */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">À propos de moi</h2>
            <div className="mt-3 text-slate-700 leading-relaxed whitespace-pre-line">
              {teacher.about_me || teacher.bio || "Le professeur n'a pas encore renseigné sa présentation."}
            </div>
          </section>

          {/* Vidéo de présentation */}
          {teacher.videoUrl && (
            <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">Vidéo de présentation</h2>
              {teacher.videoUrl.includes('firebasestorage.googleapis.com') ? (
                <video
                  src={teacher.videoUrl}
                  controls
                  className="w-full rounded-xl max-h-[450px] bg-black"
                />
              ) : getEmbedUrl(teacher.videoUrl) ? (
                <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                  <iframe
                    src={getEmbedUrl(teacher.videoUrl)}
                    title="Présentation du professeur"
                    className="absolute inset-0 w-full h-full rounded-xl"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : null}
            </section>
          )}

          {/* À propos du cours */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">À propos du cours</h2>
            <div className="mt-3 text-slate-700 leading-relaxed whitespace-pre-line">
              {teacher.about_course || "Le professeur n'a pas encore renseigné la description détaillée du cours."}
            </div>
          </section>

          {/* Certifications */}
          {(teacher.certificatesUrls || []).length > 0 && (
            <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 mb-4">Certifications & diplômes</h2>
              <div className="flex flex-wrap gap-3">
                {(teacher.certificatesUrls || []).map((url, i) => {
                  const isPdf = /\.pdf(\?|$)/i.test(url) || url.toLowerCase().includes('%2epdf');
                  const raw = decodeURIComponent(url.split('/').pop().split('?')[0]);
                  const fileName = raw.replace(/^\d+_/, '').slice(0, 50) || `Certificat ${i + 1}`;
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition"
                    >
                      <span>{isPdf ? '📄' : '🖼️'}</span>
                      <span>{fileName}</span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tarifs (tu m'as dit : enlever la section "mode", et mettre tarifs après) */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Tarifs</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-700">
              {teacher.presentiel_enabled && (
                <div className="border rounded-xl p-4">
                  <div className="font-semibold">Présentiel</div>
                  <div className="mt-2 text-2xl font-extrabold text-primary">
                    {displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(0)} € / h` : "—"}
                  </div>
                  {basePrice > 0 && (
                    <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                      <div>Prof reçoit : <span className="font-medium text-slate-700">{basePrice.toFixed(0)} €</span></div>
                      <div>Frais EduKaraib : <span className="font-medium text-slate-700">10 €</span></div>
                    </div>
                  )}
                  {displayPack5Presentiel != null && <div className="mt-2 text-sm">Pack 5h : <b>{displayPack5Presentiel.toFixed(0)} €</b> <span className="text-green-600 text-xs">(−10%)</span></div>}
                  {displayPack10Presentiel != null && <div className="mt-1 text-sm">Pack 10h : <b>{displayPack10Presentiel.toFixed(0)} €</b> <span className="text-green-600 text-xs">(−10%)</span></div>}
                </div>
              )}

              {teacher.visio_enabled && (
                <div className="border rounded-xl p-4">
                  <div className="font-semibold">Visio</div>
                  <div className="mt-2 text-2xl font-extrabold text-primary">
                    {displayHourVisio != null ? `${displayHourVisio.toFixed(0)} € / h` : "—"}
                  </div>
                  {effectiveVisio > 0 && (
                    <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                      <div>Prof reçoit : <span className="font-medium text-slate-700">{effectiveVisio.toFixed(0)} €</span></div>
                      <div>Frais EduKaraib : <span className="font-medium text-slate-700">10 €</span></div>
                    </div>
                  )}
                  {displayPack5Visio != null && <div className="mt-2 text-sm">Pack 5h : <b>{displayPack5Visio.toFixed(0)} €</b> <span className="text-green-600 text-xs">(−10%)</span></div>}
                  {displayPack10Visio != null && <div className="mt-1 text-sm">Pack 10h : <b>{displayPack10Visio.toFixed(0)} €</b> <span className="text-green-600 text-xs">(−10%)</span></div>}
                </div>
              )}

              {!teacher.presentiel_enabled && !teacher.visio_enabled && (
                <div className="text-gray-500">Tarifs non disponibles.</div>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-400">
              Les frais EduKaraib (10 €/h) couvrent le paiement sécurisé, la visio intégrée et le support. Le professeur reçoit directement sa part sur son compte bancaire.
            </p>
          </section>

          {/* Avis */}
          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <ReviewsBlock reviews={reviews} reviewerInfo={reviewerInfo} getReviewerId={getReviewerId} />
          </section>

          {/* PROFS SIMILAIRES (STOPPER) */}
          <section ref={stopRef} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Profs similaires</h2>
              <span className="text-sm text-slate-500">
                Même matière ({String(teacher.subjects || '').split(',')[0].trim() || '—'})
              </span>
            </div>

            {loadingSimilar && (
              <div className="mt-4 text-sm text-slate-500">Chargement…</div>
            )}

            {!loadingSimilar && similarTeachers.length === 0 && (
              <div className="mt-4 text-sm text-slate-500">Aucun professeur similaire trouvé pour le moment.</div>
            )}

            {/* Mobile: slider / Desktop: grid 4 colonnes */}
            <div className="mt-5">
              {/* MOBILE — slider horizontal */}
              <div className="lg:hidden -mx-2 px-2 overflow-x-auto pb-2">
                <div className="flex gap-3 snap-x snap-mandatory">
                  {similarTeachers.map((t) => {
                    const displayName = t.fullName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Professeur';
                    const firstName = displayName.split(' ')[0];
                    const avatar = t.avatarUrl || t.avatar_url || t.photoURL || '/avatar-default.png';
                    const city = t.city || t.location || 'Caraïbes & DOM-TOM';
                    const modeLabel = t.presentiel_enabled && t.visio_enabled ? `${city} & webcam`
                      : t.visio_enabled ? 'Webcam' : city;
                    const price = t.price_per_hour || t.visio_price_per_hour;
                    const rating = Number(t.avgRating || 0);
                    const reviews = Number(t.reviewsCount || 0);
                    const isCertified = reviews >= 5;

                    return (
                      <button
                        key={t.id}
                        onClick={() => { window.location.href = `/profils/${t.id}`; }}
                        className="snap-start shrink-0 w-[200px] text-left rounded-2xl overflow-hidden hover:shadow-lg transition-shadow bg-white border border-gray-100 shadow-sm relative"
                        type="button"
                      >
                        {/* Badge certifié */}
                        {isCertified && (
                          <div className="absolute top-2 left-2 z-10">
                            <CertifiedBadge />
                          </div>
                        )}
                        {/* Photo avec nom + ville superposés */}
                        <div className="relative h-44">
                          <img src={avatar} alt={firstName} className="absolute inset-0 w-full h-full object-cover object-top" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <div className="font-extrabold text-white text-base leading-tight">{firstName}</div>
                            <div className="text-white/80 text-xs mt-0.5">{modeLabel}</div>
                          </div>
                        </div>
                        {/* Infos */}
                        <div className="px-3 py-2.5 space-y-1.5">
                          {rating > 0 && (
                            <div className="flex items-center gap-1 text-xs">
                              <span className="text-yellow-400">★</span>
                              <span className="font-bold text-slate-800">{rating.toFixed(1)}</span>
                              <span className="text-slate-400">({reviews})</span>
                            </div>
                          )}
                          {price > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">{Number(price) + 10} €/h</span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DESKTOP — grid 4 colonnes, max 4 profs */}
              <div className="hidden lg:grid grid-cols-4 gap-4">
                {similarTeachers.slice(0, 4).map((t) => {
                  const displayName = t.fullName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Professeur';
                  const firstName = displayName.split(' ')[0];
                  const avatar = t.avatarUrl || t.avatar_url || t.photoURL || '/avatar-default.png';
                  const city = t.city || t.location || 'Caraïbes & DOM-TOM';
                  const modeLabel = t.presentiel_enabled && t.visio_enabled ? `${city} & webcam`
                    : t.visio_enabled ? 'Webcam' : city;
                  const price = t.price_per_hour || t.visio_price_per_hour;
                  const rating = Number(t.avgRating || 0);
                  const reviews = Number(t.reviewsCount || 0);
                    const isCertified = reviews >= 5;

                  return (
                    <button
                      key={t.id}
                      onClick={() => { window.location.href = `/profils/${t.id}`; }}
                      className="text-left rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-200 bg-white border border-gray-100 shadow-sm group relative"
                      type="button"
                    >
                      {isCertified && (
                        <div className="absolute top-2 left-2 z-10"><CertifiedBadge /></div>
                      )}
                      {/* Grande photo avec overlay gradient + nom superposé comme Superprof */}
                      <div className="relative h-52 bg-gray-100 overflow-hidden">
                        <img
                          src={avatar}
                          alt={firstName}
                          className="absolute inset-0 w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                        />
                        {/* Gradient sombre en bas */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                        {/* Nom + ville sur la photo */}
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <div className="font-extrabold text-white text-lg leading-tight">{firstName}</div>
                          <div className="text-white/75 text-xs mt-0.5">{modeLabel}</div>
                        </div>
                      </div>

                      {/* Infos sous la photo */}
                      <div className="px-3 pt-2.5 pb-3 space-y-2">
                        {/* Étoiles + avis */}
                        {rating > 0 && (
                          <div className="flex items-center gap-1.5 text-sm">
                            <span className="text-yellow-400 font-bold">★</span>
                            <span className="font-bold text-slate-800">{rating.toFixed(1)}</span>
                            <span className="text-slate-400 text-xs">({reviews} avis)</span>
                          </div>
                        )}

                        {/* Prix */}
                        {price > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-base font-extrabold text-slate-900">{Number(price) + 10} €/h</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </main>

        {/* COLONNE DROITE (STICKY)   */}
        <aside className="hidden lg:block lg:col-span-4 relative">
          <div
            ref={stickyRef}
            className="space-y-4"
            style={
              stickyMode === 'stopped'
                ? { position: 'absolute', top: `${stickyTopPx}px`, width: '100%' }
                : { position: 'sticky', top: '24px' }
            }
          >

            {/* Carte prof unique (SUPERPROF LIKE) */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              {/* Photo + badge mode dans la photo */}
              <div className="relative">
                <img
                  src={teacher.avatarUrl || teacher.avatar_url || teacher.photoURL || "/avatar-default.png"}
                  alt={teacher.fullName || "Prof"}
                  className="w-full h-64 object-cover rounded-b-2xl"
                />

                <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full text-xs font-bold bg-black/65 text-white">
                  {modeLabel}
                </div>
              </div>

              <div className="p-5">
                <div className="text-lg font-extrabold text-slate-900">
                  {teacher.firstName || ""} {teacher.lastName || teacher.fullName || "Professeur"}
                </div>

                {/* étoiles + nb avis + badge certifié */}
                <div className="mt-2 flex items-center flex-wrap gap-2 text-sm">
                  <span className="text-yellow-500">
                    {"★".repeat(Math.round(avgRating || 0)).padEnd(5, "☆")}
                  </span>
                  <span className="text-slate-700 font-semibold">{avgRating ? avgRating.toFixed(1) : "0.0"}</span>
                  <span className="text-slate-500">({reviewsCount} avis)</span>
                  {reviewsCount >= 5 && <CertifiedBadge />}
                </div>

                {/* Tarifs à l'heure (visio / présentiel) */}
                <div className="mt-2 text-sm text-slate-700">
                  {teacher.presentiel_enabled && (
                    <div>
                      Présentiel : <span className="font-extrabold">{displayHourPresentiel != null ? `${displayHourPresentiel.toFixed(2)} € / h` : '—'}</span>
                    </div>
                  )}
                  {teacher.visio_enabled && (
                    <div>
                      Visio : <span className="font-extrabold">{displayHourVisio != null ? `${displayHourVisio.toFixed(2)} € / h` : '—'}</span>
                    </div>
                  )}
                </div>

                {/* nb d'élèves — désactivé temporairement
                <div className="mt-2 text-sm text-slate-600">
                {uniqueStudentsCount} élève{uniqueStudentsCount > 1 ? "s" : ""} a déjà pris un cours avec ce professeur
                </div> */
                }
                {/* Bouton contacter */}
                {!isOwnProfile && (
                  <button
                    className="mt-4 w-full bg-yellow-400 text-slate-900 px-5 py-3 rounded-xl font-semibold shadow hover:bg-yellow-500 transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      navigate(`/chat/${teacherId}`);
                    }}
                  >
                    Contacter le professeur
                  </button>
                )}

                {/* Parent : choix enfant (DESKTOP - fusionné dans la carte) */}
                {currentRole === "parent" && (
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Qui est l'élève ?
                    </label>

                    <select
                      className="w-full border rounded-xl px-3 py-2 bg-white"
                      value={selectedStudentId || meUid || ""}
                      onChange={(e) => setSelectedStudentId(e.target.value)}
                    >
                      {meUid && <option value={meUid}>Moi (parent)</option>}
                      {children.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.full_name || k.fullName || k.name || "Enfant"}
                        </option>
                      ))}
                    </select>

                    <p className="mt-2 text-xs text-slate-500">
                      Les créneaux en rouge sont indisponibles pour l'élève sélectionné.
                    </p>
                  </div>
                )}

                {/* Mode + Pack côte à côte */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Mode</label>
                    {onlyMode ? (
                      <div className="w-full border rounded-xl px-3 py-2 bg-gray-50 text-slate-800 font-semibold text-sm">
                        {onlyMode === "visio" ? "Visio" : "Présentiel"}
                      </div>
                    ) : (
                      <select
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                        value={bookMode}
                        onChange={(e) => setBookMode(e.target.value)}
                      >
                        <option value="presentiel">Présentiel</option>
                        {teacher.visio_enabled && <option value="visio">Visio</option>}
                      </select>
                    )}
                  </div>
                  
                  {packChoice === 5 && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Code promo</label>
                      <div className="flex gap-2 items-stretch">
                        <input
                          value={promoCode}
                          onChange={(e) => { setPromoCode(e.target.value); setPromoOk(false); setPromoMsg(''); }}
                          className="flex-1 min-w-0 border rounded-xl px-3 py-2 text-sm"
                          placeholder="Ex: AVIS-9F3K2Q"
                        />
                        <button
                          type="button"
                          onClick={checkPromo}
                          className="shrink-0 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"
                        >
                          Appliquer
                        </button>
                      </div>
                      {promoMsg && <div className="mt-2 text-[11px] text-slate-600">{promoMsg}</div>}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Pack</label>
                    <select
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                      value={packChoice}
                      onChange={(e) => setPackChoice(Number(e.target.value))}
                    >
                      <option value={0}>Aucun pack</option>
                      <option value={5}>Pack 5h (+{promoOk ? 2 : 1}h offerte{promoOk ? 's' : ''})</option>
                      <option value={10}>Pack 10h (+2h offertes)</option>
                    </select>
                  </div>
                </div>

                {packChoice === 0 && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Nombre d'heures
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={hoursWanted}
                      onChange={(e) => setHoursWanted(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                      placeholder="Ex: 3"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Vous devrez sélectionner exactement {hoursWanted} créneau(x).
                    </p>
                  </div>
                )}

                {/* Bouton réserver */}
                {(!isTeacherUser && !isOwnProfile) && (
                  <button
                    className="mt-4 w-full bg-primary text-white px-5 py-3 rounded-xl font-semibold shadow hover:bg-primary-dark transition"
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      setTrialMode(false);
                      setShowBooking(true);
                      setConfirmationMsg("");
                    }}
                  >
                    {isBooking ? "Envoi…" : "Réserver"}
                  </button>
                )}

                {/* Essai gratuit */}
                {(!isTeacherUser && !isOwnProfile) && teacher.trial_enabled === true && (
                  <button
                    disabled={trialUsed}
                    className={`mt-2 w-full px-5 py-3 rounded-xl font-semibold shadow transition ${
                      trialUsed
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                    onClick={() => {
                      if (!auth.currentUser) return navigate("/login");
                      if (trialUsed) return;
                      setTrialMode(true);
                      setPackChoice(0);
                      setHoursWanted(1);
                      setShowBooking(true);
                      setConfirmationMsg("");
                    }}
                  >
                    {trialUsed ? "Essai gratuit dejà utilisé" : "Essai gratuit (1h)"}
                  </button>
                )}

                {confirmationMsg && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm">
                    {confirmationMsg}
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Modal de réservation */}
      {(!isTeacherUser && !isOwnProfile) && showBooking && (
        <BookingModal
          availability={teacher.availability || {}}
          bookedSlots={bookedSlots}
          remainingBySlot={remainingBySlot}
          onBook={handleBooking}
          onClose={() => setShowBooking(false)}
          orderDays={DAYS_ORDER}
          multiSelect={true}
          requiredCount={requiredCount}
          freeCount={freeCount}
          canBook={canBook}
          myStudentIds={children.map(c => c.id)}
          idToName={Object.fromEntries(children.map(c => [c.id, c.full_name || c.fullName || c.name || 'Enfant']))}
          promoFreeCount={(packChoice === 5 && promoOk) ? 1 : 0}
        />
      )}
    </div>
  );
}