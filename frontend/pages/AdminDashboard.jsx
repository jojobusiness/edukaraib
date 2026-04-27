import React, { useEffect, useMemo, useState } from 'react';
import { auth, db } from '../lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { sendPasswordResetEmail, signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import fetchWithAuth from '../utils/fetchWithAuth';

// 👇 imports messagerie (utilisés dans l'onglet "Discussions")
import Messages from './Messages';

/* ===========================
   Utils
=========================== */
const fmtMoney = (cents = 0, currency = 'EUR') =>
  (Number(cents || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency });

const toDateStr = (ts) => {
  try {
    if (!ts) return '';
    if (ts?.toDate) return ts.toDate().toLocaleString('fr-FR');
    return new Date(ts).toLocaleString('fr-FR');
  } catch {
    return '';
  }
};

const nameOf = (u) =>
  u?.fullName ||
  u?.full_name ||
  u?.name ||
  [u?.firstName, u?.lastName].filter(Boolean).join(' ') ||
  'Sans nom';

/* ===========================
   Petite modale remboursement
=========================== */
function RefundModal({ open, onClose, onConfirm, payment, teacher }) {
  const [amount, setAmount] = useState(''); // en euros (optionnel)
  const [reason, setReason] = useState('requested_by_customer');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount('');
      setReason('requested_by_customer');
      setLoading(false);
    }
  }, [open]);

  if (!open || !payment) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm({
        paymentId: payment.id,
        amount_eur: amount ? Number(amount) : undefined,
        reason,
      });
    } finally {
      setLoading(false);
    }
  };

  const grossEur =
    typeof payment.amount === 'number'
      ? payment.amount / 100
      : Number(payment.gross_eur || 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-4 border-b">
          <div className="text-lg font-semibold">Rembourser un paiement</div>
          <div className="text-xs text-gray-500 mt-1">
            Prof : <b>{teacher || payment.teacher_id}</b> ·
            Montant initial : <b>{grossEur ? `${grossEur.toFixed(2)} €` : '—'}</b>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium">Montant à rembourser (optionnel)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder={`laisser vide pour rembourser ${grossEur ? `${grossEur.toFixed(2)} €` : 'le total'}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Raison</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="requested_by_customer">requested_by_customer</option>
              <option value="duplicate">duplicate</option>
              <option value="fraudulent">fraudulent</option>
              <option value="other">other</option>
            </select>
          </div>

          <div className="text-xs text-gray-500">
            • Si le paiement n'a pas encore été reversé au prof, un <b>refund</b> simple est créé. <br />
            • S'il a déjà été reversé, on fait un <b>reverse transfer</b> côté Stripe, puis un refund côté client si nécessaire.
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200">
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? 'Traitement…' : 'Confirmer le remboursement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- helper: envoi d'email pro via /api/notify-email (avec lookup email par uid) ---
async function getUserEmail(uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(db, "users", uid));
    return s.exists() ? (s.data().email || null) : null;
  } catch {
    return null;
  }
}

async function notifyByEmail(uid, title, message, ctaUrl, ctaText = "Ouvrir le tableau de bord") {
  try {
    const to = await getUserEmail(uid);
    if (!to) return;
    await fetchWithAuth("/api/notify-email", {
      method: "POST",
      body: JSON.stringify({ to, title, message, ctaUrl, ctaText }),
    });
  } catch (e) {
    console.warn("notify-email error:", e);
  }
}
// --- /helper ---

/* ===========================
   AdminDashboard (sans layout)
=========================== */
export default function AdminDashboard() {
  const [tab, setTab] = useState('stats'); // stats | accounts | payments | messages | discussions | influencers
  const [meRole, setMeRole] = useState(null);
  const [meId, setMeId] = useState(null);

  // --- Accounts state ---
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all'); // all|student|parent|teacher|admin|disabled
  const [selectedIds, setSelectedIds] = useState(new Set());

  // --- Payments state ---
  const [payments, setPayments] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [payLoading, setPayLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // --- Refund modal ---
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundTeacherName, setRefundTeacherName] = useState('');

  // --- Messages broadcast ---
  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  // --- Discussions (inline, sans navigation) ---
  const [selectedChatId, setSelectedChatId] = useState(null);

  // 🔹 Liste des conversations compactes (onglet Discussions)
  const [convs, setConvs] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);

  // --- Influenceurs state ---
  const [influencers, setInfluencers] = useState([]);
  const [influLoading, setInfluLoading] = useState(false);
  const [influFilter, setInfluFilter] = useState("all"); // all | pending | inactive
  const [influSearch, setInfluSearch] = useState("");
  const [influPayoutLoading, setInfluPayoutLoading] = useState(null);
  const [influToggleLoading, setInfluToggleLoading] = useState(null);

  // --- Modification code promo influenceur ---
  const [influCodeEdit, setInfluCodeEdit] = useState(null);   // id de la ligne en cours d'édition
  const [influCodeInput, setInfluCodeInput] = useState('');   // valeur saisie
  const [influCodeSaving, setInfluCodeSaving] = useState(false);

  /* ----- Load current user & role ----- */
  useEffect(() => {
    const cur = auth.currentUser;
    if (!cur) return;
    setMeId(cur.uid);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', cur.uid));
        setMeRole(snap.exists() ? snap.data()?.role : null);
      } catch {
        setMeRole(null);
      }
    })();
  }, []);

  /* ----- Accounts: live users ----- */
  useEffect(() => {
    setUsersLoading(true);
    const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsers(list);
        setUsersLoading(false);
      },
      () => setUsersLoading(false)
    );
    return () => unsub();
  }, []);

  /* ----- Payments: lazy load on tab open or on filter ----- */
  useEffect(() => {
    if (tab !== 'payments') return;
    (async () => {
      setPayLoading(true);

      const [pSnap, rSnap, poSnap] = await Promise.all([
        getDocs(query(collection(db, 'payments'), orderBy('created_at', 'desc'), limit(500))),
        getDocs(query(collection(db, 'refunds'), orderBy('created_at', 'desc'), limit(500))),
        getDocs(query(collection(db, 'payouts'), orderBy('created_at', 'desc'), limit(500))),
      ]);

      const inRange = (ts) => {
        if (!dateFrom && !dateTo) return true;
        const t = ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
        if (dateFrom) {
          const start = new Date(dateFrom + 'T00:00:00').getTime();
          if (t < start) return false;
        }
        if (dateTo) {
          const end = new Date(dateTo + 'T23:59:59').getTime();
          if (t > end) return false;
        }
        return true;
      };

      const p = pSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => inRange(x.created_at));
      const r = rSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => inRange(x.created_at));
      const po = poSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => inRange(x.created_at));

      setPayments(p);
      setRefunds(r);
      setPayouts(po);
      setPayLoading(false);
    })();
  }, [tab, dateFrom, dateTo]);

  useEffect(() => {
    if (tab !== 'stats') return;
    setLessonsLoading(true);
    setPayLoading(true);

    Promise.all([
      getDocs(query(collection(db, 'lessons'), orderBy('created_at', 'desc'), limit(1000))),
      getDocs(query(collection(db, 'payments'), orderBy('created_at', 'desc'), limit(500))),
    ]).then(([lessonsSnap, paymentsSnap]) => {
      setLessons(lessonsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPayments(paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLessonsLoading(false);
      setPayLoading(false);
    }).catch(() => {
      setLessonsLoading(false);
      setPayLoading(false);
    });
  }, [tab]);

  // Charger les conversations (compact, sans layout) quand l'onglet Discussions est actif
  useEffect(() => {
    if (tab !== 'discussions') return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const qConvs = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', uid),
      orderBy('lastSentAt', 'desc')
    );

    const unsub = onSnapshot(qConvs, async (snap) => {
      const arr = await Promise.all(
        snap.docs.map(async (d) => {
          const c = { id: d.id, ...d.data() };
          const otherUid = (c.participants || []).find((p) => p !== uid);

          let person = users.find((u) => u.id === otherUid);
          if (!person) {
            try {
              const s = await getDoc(doc(db, 'users', otherUid));
              if (s.exists()) person = { id: s.id, ...s.data() };
            } catch {}
          }

          const name =
            (person?.fullName ||
              person?.full_name ||
              [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim() ||
              person?.name ||
              person?.displayName ||
              (typeof person?.email === 'string' ? person.email.split('@')[0] : '') ||
              'Utilisateur');
          const avatar =
            person?.avatarUrl ||
            person?.avatar_url ||
            person?.photoURL ||
            person?.photo_url ||
            '/avatar-default.png';

          return {
            cid: c.id,
            otherUid,
            name,
            avatar,
            lastMessage: c.lastMessage || '',
          };
        })
      );
      setConvs(arr);
    });
    return () => unsub();
  }, [tab, users]);

  /* ----- Influenceurs : load on tab open ----- */
  useEffect(() => {
    if (tab !== 'influencers') return;
    setInfluLoading(true);
    getDocs(query(collection(db, 'influencers'), orderBy('created_at', 'desc')))
      .then((snap) => {
        setInfluencers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setInfluLoading(false);
      })
      .catch(() => setInfluLoading(false));
  }, [tab]);

  /* ----- Derived: account filters ----- */
  const filteredUsers = useMemo(() => {
    const t = (search || '').toLowerCase().trim();
    return users.filter((u) => {
      // ⛔️ masque les admins dans la liste
      if (u?.role === 'admin') return false;

      if (roleFilter !== 'all') {
        if (roleFilter === 'disabled') {
          if (!u?.disabled) return false;
        } else if (u?.role !== roleFilter) return false;
      }
      if (!t) return true;
      const s = [u.email, nameOf(u), u.city, u.role].filter(Boolean).join(' ').toLowerCase();
      return s.includes(t);
    });
  }, [users, search, roleFilter]);

  const teacherMap = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const totals = useMemo(() => {
    const succ = payments.filter((p) => p.status === 'succeeded');
    const sum = (arr) => arr.reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const paid = sum(succ);
    const refunded = refunds.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    const net = paid - refunded;
    return { paid, refunded, net };
  }, [payments, refunds]);

  const perTeacher = useMemo(() => {
    const byId = new Map();
    const add = (tid, kind, cents) => {
      if (!byId.has(tid)) byId.set(tid, { teacher_id: tid, paid: 0, refunded: 0, net: 0 });
      const row = byId.get(tid);
      row[kind] += cents;
      row.net = row.paid - row.refunded;
      byId.set(tid, row);
    };
    payments.forEach((p) => {
      if (p.status === 'succeeded' && p.teacher_id) add(p.teacher_id, 'paid', Number(p.amount || 0));
    });
    refunds.forEach((r) => {
      if (r.teacher_id) add(r.teacher_id, 'refunded', Number(r.amount || 0));
    });
    const arr = Array.from(byId.values());
    arr.sort((a, b) => b.net - a.net);
    return arr;
  }, [payments, refunds]);

  /* ===========================
     Accounts actions
  =========================== */
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setRole = async (u, role) => {
    if (!window.confirm(`Changer le rôle de ${nameOf(u)} en "${role}" ?`)) return;
    try {
      await updateDoc(doc(db, 'users', u.id), { role });
      alert('Rôle mis à jour.');
    } catch (e) {
      console.error(e);
      alert('Impossible de modifier le rôle.');
    }
  };

  const toggleDisabled = async (u) => {
    const next = !u?.disabled;
    if (!window.confirm(`${next ? 'Désactiver' : 'Réactiver'} le compte ${nameOf(u)} ?`)) return;
    try {
      await updateDoc(doc(db, 'users', u.id), { disabled: next });
      alert('Compte mis à jour.');
    } catch (e) {
      console.error(e);
      alert('Impossible de modifier le compte.');
    }
  };

  const resetPassword = async (u) => {
    if (!u?.email) return alert("Cet utilisateur n'a pas d'email.");
    try {
      await sendPasswordResetEmail(auth, u.email);
      alert('Email de réinitialisation envoyé.');
    } catch (e) {
      console.error(e);
      alert("Impossible d'envoyer le reset password.");
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Supprimer définitivement ${nameOf(u)} ?`)) return;
    try {
      await deleteDoc(doc(db, 'users', u.id));
      alert('Utilisateur supprimé.');
    } catch (e) {
      console.error(e);
      alert('Suppression impossible côté Firestore (le compte Auth restera actif si non effacé côté Auth).');
    }
  };

  /* ===========================
     Refund action
  =========================== */
  const openRefund = async (payment) => {
    setRefundTarget(payment);
    const teacher = teacherMap.get(payment.teacher_id);
    setRefundTeacherName(teacher ? nameOf(teacher) : '');
    setRefundOpen(true);
  };

  const confirmRefund = async ({ paymentId, amount_eur, reason }) => {
    try {
      const body = { paymentId };
      if (amount_eur != null && !Number.isNaN(Number(amount_eur))) body.amount_eur = Number(amount_eur);
      if (reason) body.reason = reason;

      const resp = await fetchWithAuth('/api/refund', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!resp || resp.error) throw new Error(resp?.error || 'Échec du remboursement');

      alert('Remboursement lancé avec succès.');
      setRefundOpen(false);
      setRefundTarget(null);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Remboursement impossible.');
    }
  };

  /* ===========================
     Guards
  =========================== */
  if (meRole === null) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-500">Chargement…</div>
    </div>;
  }
  if (meRole !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="w-full bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <Link to="/" className="text-xl font-extrabold text-primary hover:underline">EduKaraib</Link>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Accès refusé. Votre rôle doit être <b>admin</b>.
          </div>
        </main>
      </div>
    );
  }

  /* ===========================
     UI (sans layout)
  =========================== */
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="w-full bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold text-primary hover:underline">EduKaraib</Link>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Admin</span>
            <button
              onClick={() => {
                signOut(auth)
                  .then(() => window.location.href = "/")
                  .catch((e) => alert("Erreur lors de la déconnexion : " + e.message));
              }}
              className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-primary mb-4">Tableau de bord Administrateur</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'stats' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('stats')}
          >
            📊 Stats
          </button>
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'accounts' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('accounts')}
          >
            Comptes
          </button>
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'payments' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('payments')}
          >
            Paiements & Revenus
          </button>
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'messages' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('messages')}
          >
            Messages
          </button>
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'discussions' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('discussions')}
          >
            Discussions
          </button>
          <button
            className={`px-4 py-2 rounded-lg border ${tab === 'influencers' ? 'bg-primary text-white border-primary' : 'bg-white'}`}
            onClick={() => setTab('influencers')}
          >
            🎤 Influenceurs
          </button>
        </div>

        {/* === ACCOUNTS TAB === */}
        {tab === 'accounts' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                className="border rounded-lg px-3 py-2"
                placeholder="Rechercher nom/email/ville/rôle…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="border rounded-lg px-3 py-2"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="all">Tous les rôles</option>
                <option value="student">Élève</option>
                <option value="parent">Parent</option>
                <option value="teacher">Professeur</option>
                <option value="influencer">Influenceur</option>
                <option value="admin">Admin</option>
                <option value="disabled">Désactivés</option>
              </select>

              <div className="col-span-1 md:col-span-2 flex items-center gap-2">
                <button
                  className="px-3 py-2 rounded bg-gray-100 border hover:bg-gray-200"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Désélectionner
                </button>
                <div className="text-sm text-gray-600">
                  Sélectionnés : <b>{selectedIds.size}</b>
                </div>
              </div>
            </div>

            <div className="bg-white border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 w-10"></th>
                    <th className="p-2 text-left">Nom</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Rôle</th>
                    <th className="p-2 text-left">Ville</th>
                    <th className="p-2 text-left">État</th>
                    <th className="p-2 text-left">Créé le</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-gray-500">Chargement…</td>
                    </tr>
                  )}
                  {!usersLoading && filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-gray-400">Aucun compte</td>
                    </tr>
                  )}
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(u.id)}
                          onChange={() => toggleSelect(u.id)}
                        />
                      </td>
                      <td className="p-2">{nameOf(u)}</td>
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            u.role === 'teacher'    ? 'bg-emerald-100 text-emerald-700' :
                            u.role === 'parent'     ? 'bg-purple-100 text-purple-700'  :
                            u.role === 'influencer' ? 'bg-pink-100 text-pink-700'      :
                            u.role === 'student'    ? 'bg-blue-100 text-blue-700'      :
                            'bg-gray-100 text-gray-600'
                          }`}>{u.role || 'n/a'}</span>
                          <select
                            className="border rounded px-1 py-0.5 text-xs"
                            value={u.role || 'student'}
                            onChange={(e) => setRole(u, e.target.value)}
                          >
                            <option value="student">student</option>
                            <option value="parent">parent</option>
                            <option value="teacher">teacher</option>
                            <option value="influencer">influencer</option>
                            <option value="admin">admin</option>
                          </select>
                        </span>
                      </td>
                      <td className="p-2">{u.city || ''}</td>
                      <td className="p-2">
                        {u.disabled ? (
                          <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">désactivé</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-green-100 text-green-700">actif</span>
                        )}
                      </td>
                      <td className="p-2">{toDateStr(u.createdAt)}</td>
                      <td className="p-2 text-right">
                        <div className="flex gap-2 justify-end">
                          <Link
                            to={`/chat/${u.id}?from=admin`}
                            className="px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary-dark"
                            title="Contacter par messagerie"
                          >
                            Contacter
                          </Link>
                          <button
                            className="px-2 py-1 text-xs rounded bg-amber-100 hover:bg-amber-200"
                            onClick={() => resetPassword(u)}
                          >
                            Reset MDP
                          </button>
                          <button
                            className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200"
                            onClick={() => toggleDisabled(u)}
                          >
                            {u.disabled ? 'Réactiver' : 'Désactiver'}
                          </button>
                          <button
                            className="px-2 py-1 text-xs rounded bg-red-100 hover:bg-red-200"
                            onClick={() => removeUser(u)}
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === PAYMENTS TAB === */}
        {tab === 'payments' && (
          <div className="space-y-6">
            {/* Filtres */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm text-gray-600">Du</label>
                <input
                  type="date"
                  className="border rounded px-3 py-2 w-full"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600">Au</label>
                <input
                  type="date"
                  className="border rounded px-3 py-2 w-full"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white border rounded-xl p-4">
                <div className="text-gray-500 text-sm">Paiements réussis</div>
                <div className="text-xl font-bold">{fmtMoney(payments.filter(p=>p.status==='succeeded').reduce((a,b)=>a+Number(b.amount||0),0))}</div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-gray-500 text-sm">Remboursés</div>
                <div className="text-xl font-bold">{fmtMoney(refunds.reduce((a,b)=>a+Number(b.amount||0),0))}</div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-gray-500 text-sm">Revenu net</div>
                <div className="text-xl font-bold">
                  {fmtMoney(
                    payments.filter(p=>p.status==='succeeded').reduce((a,b)=>a+Number(b.amount||0),0)
                    - refunds.reduce((a,b)=>a+Number(b.amount||0),0)
                  )}
                </div>
              </div>
            </div>

            {/* Agrégat par prof */}
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="p-3 border-b font-semibold">Revenus par professeur</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">Professeur</th>
                    <th className="p-2 text-right">Payé</th>
                    <th className="p-2 text-right">Remboursé</th>
                    <th className="p-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payLoading && (
                    <tr><td colSpan={4} className="p-4 text-center text-gray-500">Chargement…</td></tr>
                  )}
                  {!payLoading && users.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-gray-400">Aucune donnée</td></tr>
                  )}
                  {!payLoading && (() => {
                    const byId = new Map();
                    const add = (tid, kind, cents) => {
                      if (!byId.has(tid)) byId.set(tid, { teacher_id: tid, paid: 0, refunded: 0, net: 0 });
                      const row = byId.get(tid);
                      row[kind] += cents;
                      row.net = row.paid - row.refunded;
                      byId.set(tid, row);
                    };
                    payments.forEach((p) => {
                      if (p.status === 'succeeded' && p.teacher_id) add(p.teacher_id, 'paid', Number(p.amount || 0));
                    });
                    refunds.forEach((r) => {
                      if (r.teacher_id) add(r.teacher_id, 'refunded', Number(r.amount || 0));
                    });
                    const arr = Array.from(byId.values()).sort((a,b)=>b.net-a.net);
                    return arr.map((row) => {
                      const t = teacherMap.get(row.teacher_id);
                      return (
                        <tr key={row.teacher_id} className="border-t">
                          <td className="p-2">{t ? nameOf(t) : row.teacher_id}</td>
                          <td className="p-2 text-right">{fmtMoney(row.paid)}</td>
                          <td className="p-2 text-right text-amber-700">{fmtMoney(row.refunded)}</td>
                          <td className="p-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            {/* Détails */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="p-3 border-b font-semibold">Derniers paiements</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Prof</th>
                      <th className="p-2 text-right">Montant</th>
                      <th className="p-2 text-left">Statut</th>
                      <th className="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payLoading && (
                      <tr><td colSpan={5} className="p-4 text-center text-gray-500">Chargement…</td></tr>
                    )}
                    {!payLoading && payments.length === 0 && (
                      <tr><td colSpan={5} className="p-4 text-center text-gray-400">Aucun paiement</td></tr>
                    )}
                    {!payLoading && payments.map((p) => {
                      const t = teacherMap.get(p.teacher_id);
                      const canRefund = ['succeeded', 'held', 'released'].includes(String(p.status || ''));
                      return (
                        <tr key={p.id} className="border-t">
                          <td className="p-2">{toDateStr(p.created_at)}</td>
                          <td className="p-2">{t ? nameOf(t) : p.teacher_id}</td>
                          <td className="p-2 text-right">{fmtMoney(p.amount, p.currency || 'EUR')}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded ${p.status === 'succeeded' ? 'bg-green-100 text-green-700' : p.status === 'refunded' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100'}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="p-2 text-right">
                            {canRefund && (
                              <button
                                className="px-3 py-1 rounded text-sm border border-red-300 text-red-700 hover:bg-red-50"
                                onClick={() => openRefund(p)}
                              >
                                Rembourser
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="p-3 border-b font-semibold">Remboursements</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Prof</th>
                      <th className="p-2 text-right">Montant</th>
                      <th className="p-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payLoading && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-500">Chargement…</td></tr>
                    )}
                    {!payLoading && refunds.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-400">Aucun remboursement</td></tr>
                    )}
                    {!payLoading && refunds.map((r) => {
                      const t = teacherMap.get(r.teacher_id);
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="p-2">{toDateStr(r.created_at)}</td>
                          <td className="p-2">{t ? nameOf(t) : r.teacher_id}</td>
                          <td className="p-2 text-right">{fmtMoney(r.amount, r.currency || 'EUR')}</td>
                          <td className="p-2">
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                              {r.status || 'refunded'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Virements en attente (RIB manquant) */}
              <div className="bg-white border rounded-xl overflow-hidden lg:col-span-2">
                <div className="p-3 border-b font-semibold flex items-center gap-2">
                  <span>⚠️ Virements en attente (RIB manquant)</span>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                    {payments.filter(p => p.status === 'payout_pending_rib').length}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Prof</th>
                      <th className="p-2 text-left">Leçon</th>
                      <th className="p-2 text-right">Net à verser</th>
                      <th className="p-2 text-left">Depuis</th>
                      <th className="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.filter(p => p.status === 'payout_pending_rib').length === 0 && (
                      <tr><td colSpan={5} className="p-4 text-center text-gray-400">Aucun virement en attente ✅</td></tr>
                    )}
                    {payments.filter(p => p.status === 'payout_pending_rib').map((p) => {
                      const t = teacherMap.get(p.teacher_uid || p.teacher_id);
                      return (
                        <tr key={p.id} className="border-t bg-amber-50">
                          <td className="p-2 font-semibold">{t ? nameOf(t) : p.teacher_uid}</td>
                          <td className="p-2 text-xs text-gray-500">{p.pack_id ? `Pack ${p.pack_id}` : p.lesson_id}</td>
                          <td className="p-2 text-right font-bold text-green-700">{Number(p.net_to_teacher_eur || 0).toFixed(2)} €</td>
                          <td className="p-2 text-xs">{toDateStr(p.payout_pending_since || p.created_at)}</td>
                          <td className="p-2 text-right">
                            <button
                              className="px-3 py-1 rounded text-sm bg-green-600 text-white hover:bg-green-700"
                              onClick={async () => {
                                if (!window.confirm(`Marquer le virement de ${Number(p.net_to_teacher_eur||0).toFixed(2)}€ à ${t ? nameOf(t) : p.teacher_uid} comme effectué ?`)) return;
                                try {
                                  await updateDoc(doc(db, 'payments', p.id), {
                                    status: 'released',
                                    released_at: new Date(),
                                    payout_method: 'manual_rib',
                                  });
                                  alert('Virement marqué comme effectué.');
                                  setPayments(prev => prev.map(x => x.id === p.id ? { ...x, status: 'released' } : x));
                                } catch (e) {
                                  alert('Erreur : ' + e.message);
                                }
                              }}
                            >
                              ✅ Marquer viré
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-white border rounded-xl overflow-hidden lg:col-span-2">
                <div className="p-3 border-b font-semibold">Payouts (virements aux profs)</div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Prof</th>
                      <th className="p-2 text-right">Montant</th>
                      <th className="p-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payLoading && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-500">Chargement…</td></tr>
                    )}
                    {!payLoading && payouts.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-400">Aucun payout</td></tr>
                    )}
                    {!payLoading && payouts.map((po) => {
                      const t = teacherMap.get(po.teacher_id);
                      return (
                        <tr key={po.id} className="border-t">
                          <td className="p-2">{toDateStr(po.created_at)}</td>
                          <td className="p-2">{t ? nameOf(t) : po.teacher_id}</td>
                          <td className="p-2 text-right">{fmtMoney(po.amount, po.currency || 'EUR')}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded ${po.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>
                              {po.status || 'paid'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal remboursement */}
            <RefundModal
              open={refundOpen}
              onClose={() => setRefundOpen(false)}
              onConfirm={confirmRefund}
              payment={refundTarget}
              teacher={refundTeacherName}
            />
          </div>
        )}

        {/* === STATS TAB === */}
        {tab === 'stats' && (
          <StatsTab
            users={users}
            payments={payments}
            lessons={lessons}
            lessonsLoading={lessonsLoading || payLoading || usersLoading}
          />
        )}

        {/* === MESSAGES (broadcast) TAB === */}
        {tab === 'messages' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-3">Envoyer un message (broadcast)</h3>
              <div className="grid grid-cols-1 gap-3">
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="Titre du message"
                  value={messageTitle}
                  onChange={(e) => setMessageTitle(e.target.value)}
                />
                <textarea
                  className="border rounded-lg px-3 py-2 min-h-[140px]"
                  placeholder="Votre message…"
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                {/* Sélectionnés */}
                <button
                  className="px-4 py-2 rounded bg-primary text-white hover:bg-primary-dark disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || selectedIds.size === 0}
                  onClick={async () => {
                    try {
                      setMessageSending(true);
                      const ids = Array.from(selectedIds);
                      for (let _i = 0; _i < ids.length; _i += 20) {
                        await Promise.all(ids.slice(_i, _i + 20).map(async (uid) => {
                          await addDoc(collection(db, 'notifications'), {
                            user_id: uid,
                            title: messageTitle.trim(),
                            message: messageBody.trim(),
                            type: 'admin_broadcast',
                            created_at: serverTimestamp(),
                            from_admin: auth.currentUser?.uid || null,
                            email_disabled: true,
                          });
                          await notifyByEmail(uid, messageTitle.trim(), messageBody.trim(), "https://edukaraib.com/smart-dashboard", "Ouvrir le tableau de bord");
                        }));
                      }
                      alert('Message envoyé aux comptes sélectionnés.');
                      setMessageTitle('');
                      setMessageBody('');
                    } finally {
                      setMessageSending(false);
                    }
                  }}
                >
                  Envoyer aux sélectionnés ({selectedIds.size})
                </button>

                {/* Liste filtrée */}
                <button
                  className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-black disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || filteredUsers.length === 0}
                  onClick={async () => {
                    try {
                      setMessageSending(true);
                      for (let _i = 0; _i < filteredUsers.length; _i += 20) {
                        await Promise.all(filteredUsers.slice(_i, _i + 20).map(async (u) => {
                          await addDoc(collection(db, 'notifications'), {
                            user_id: u.id,
                            title: messageTitle.trim(),
                            message: messageBody.trim(),
                            type: 'admin_broadcast',
                            created_at: serverTimestamp(),
                            from_admin: auth.currentUser?.uid || null,
                            email_disabled: true,
                          });
                          await notifyByEmail(u.id, messageTitle.trim(), messageBody.trim(), "https://edukaraib.com/dashboard", "Ouvrir le tableau de bord");
                        }));
                      }
                      alert('Message envoyé à la liste filtrée.');
                      setMessageTitle('');
                      setMessageBody('');
                    } finally {
                      setMessageSending(false);
                    }
                  }}
                >
                  Envoyer à la liste filtrée ({filteredUsers.length})
                </button>

                {/* Tous (hors admins) */}
                <button
                  className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || users.length === 0}
                  onClick={async () => {
                    try {
                      setMessageSending(true);
                      const nonAdmins = users.filter(u => u.role !== 'admin');
                      for (let _i = 0; _i < nonAdmins.length; _i += 20) {
                        await Promise.all(nonAdmins.slice(_i, _i + 20).map(async (u) => {
                          await addDoc(collection(db, 'notifications'), {
                            user_id: u.id,
                            title: messageTitle.trim(),
                            message: messageBody.trim(),
                            type: 'admin_broadcast',
                            created_at: serverTimestamp(),
                            from_admin: auth.currentUser?.uid || null,
                            email_disabled: true,
                          });
                          await notifyByEmail(u.id, messageTitle.trim(), messageBody.trim(), "https://edukaraib.com/dashboard", "Ouvrir le tableau de bord");
                        }));
                      }
                      alert('Message envoyé à tous (hors admins).');
                      setMessageTitle('');
                      setMessageBody('');
                    } finally {
                      setMessageSending(false);
                    }
                  }}
                >
                  Envoyer à tous ({users.filter(u=>u.role!=='admin').length})
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Diffusion via <code>notifications</code>. Pour un échange direct, utilise l'onglet <b>Discussions</b>.
              </p>
            </div>

            <div className="bg-white border rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-3">Destinataires (aperçu)</h3>
              <div className="text-sm text-gray-600 mb-2">
                Filtre : <b>{roleFilter}</b>, Recherche : <b>{search || '—'}</b>
              </div>
              <div className="max-h-[400px] overflow-auto divide-y">
                {filteredUsers.slice(0, 200).map((u) => (
                  <label key={`dest:${u.id}`} className="py-2 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{nameOf(u)}</div>
                      <div className="text-xs text-gray-500">{u.email} · {u.role}</div>
                    </div>
                    <Link
                      to={`/chat/${u.id}?from=admin`}
                      className="bg-primary text-white px-3 py-1.5 rounded hover:bg-primary-dark"
                    >
                      Discuter
                    </Link>
                  </label>
                ))}
                {filteredUsers.length > 200 && (
                  <div className="py-2 text-xs text-gray-500">
                    + {filteredUsers.length - 200} autres…
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === DISCUSSIONS TAB (inline, sans layout, on reste sur la page) === */}
        {tab === 'discussions' && (
          <>
            {selectedChatId ? (
              <div className="bg-white border rounded-xl overflow-hidden h-[70vh]">
                <Messages
                  key={selectedChatId}
                  receiverId={selectedChatId}
                  onBack={() => setSelectedChatId(null)}
                />
              </div>
            ) : (
              <div className="bg-white border rounded-xl overflow-hidden">
                <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                  {convs.length === 0 && (
                    <li className="py-10 text-center text-gray-500">Aucune conversation.</li>
                  )}
                  {convs.map((c) => (
                    <li key={c.cid} className="flex items-center gap-3 p-3">
                      <img
                        src={c.avatar}
                        alt={c.name}
                        className="w-10 h-10 rounded-full object-cover border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-primary truncate">{c.name}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {c.lastMessage || 'Aucun message'}
                        </div>
                      </div>
                      <Link
                        to={`/chat/${c.otherUid}?from=admin`}
                        className="bg-primary text-white px-3 py-1.5 rounded hover:bg-primary-dark"
                      >
                        Discuter
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* === INFLUENCEURS TAB === */}
        {tab === 'influencers' && (
          <div className="space-y-6">

            {/* ── KPIs ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total influenceurs', value: influencers.length, color: 'text-blue-700' },
                { label: 'Actifs', value: influencers.filter(i => i.active !== false).length, color: 'text-emerald-700' },
                { label: 'En attente paiement', value: influencers.filter(i => (i.pendingPayout || 0) > 0).length, color: 'text-orange-600' },
                { label: 'Total commissions versées', value: influencers.reduce((s, i) => s + (i.totalEarned || 0), 0).toFixed(2) + ' €', color: 'text-purple-700' },
              ].map(k => (
                <div key={k.label} className="bg-white border rounded-xl p-4">
                  <div className="text-xs text-gray-500">{k.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* ── Filtres ── */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                className="border rounded-lg px-3 py-2 text-sm w-56"
                placeholder="Rechercher nom / email / code…"
                value={influSearch}
                onChange={e => setInfluSearch(e.target.value)}
              />
              {['all', 'pending', 'inactive'].map(f => (
                <button
                  key={f}
                  className={`px-3 py-1.5 rounded-lg border text-sm ${influFilter === f ? 'bg-primary text-white border-primary' : 'bg-white'}`}
                  onClick={() => setInfluFilter(f)}
                >
                  {f === 'all' ? 'Tous' : f === 'pending' ? '⏳ En attente' : '🔴 Inactifs'}
                </button>
              ))}
            </div>

            {/* ── Table ── */}
            {influLoading ? (
              <div className="text-center py-10 text-gray-400">Chargement…</div>
            ) : (
              <div className="bg-white border rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="p-3">Nom / Email</th>
                      <th className="p-3">Code promo</th>
                      <th className="p-3 text-right">Utilisations</th>
                      <th className="p-3 text-right">Total gagné</th>
                      <th className="p-3 text-right">En attente</th>
                      <th className="p-3 text-center">Statut</th>
                      <th className="p-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {influencers
                      .filter(i => {
                        if (influFilter === 'pending' && !(i.pendingPayout > 0)) return false;
                        if (influFilter === 'inactive' && i.active !== false) return false;
                        if (influSearch) {
                          const q = influSearch.toLowerCase();
                          return (
                            (i.name || '').toLowerCase().includes(q) ||
                            (i.email || '').toLowerCase().includes(q) ||
                            (i.code || '').toLowerCase().includes(q)
                          );
                        }
                        return true;
                      })
                      .map(influ => (
                        <tr key={influ.id} className="border-t hover:bg-gray-50">

                          {/* Nom / Email / IBAN */}
                          <td className="p-3">
                            <div className="font-medium">{influ.name || '—'}</div>
                            <div className="text-xs text-gray-400">{influ.email || '—'}</div>
                            {influ.rib && (
                              <div className="text-xs text-gray-400 font-mono mt-0.5">IBAN: {influ.rib?.slice(0,4)}••••{influ.rib?.slice(-4)}</div>
                            )}
                          </td>

                          {/* ── Code promo (éditable) ── */}
                          <td className="p-3">
                            {influCodeEdit === influ.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  className="border rounded px-2 py-1 text-xs font-mono w-28 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                                  value={influCodeInput}
                                  onChange={e => setInfluCodeInput(e.target.value.toUpperCase())}
                                  placeholder="NOUVEAU_CODE"
                                  maxLength={20}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      const newCode = influCodeInput.trim().toUpperCase();
                                      if (!newCode) return;
                                      setInfluCodeSaving(true);
                                      try {
                                        await updateDoc(doc(db, 'influencers', influ.id), { code: newCode });
                                        setInfluencers(prev => prev.map(i =>
                                          i.id === influ.id ? { ...i, code: newCode } : i
                                        ));
                                        // ✉️ Email de notification à l'influenceur
                                        if (influ.email) {
                                          await fetchWithAuth('/api/notify-email', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              to: influ.email,
                                              title: 'Votre code promo a été modifié',
                                              message: `Bonjour ${influ.name || ''},\n\nVotre code promo a été mis à jour par l'équipe EduKaraib.\n\nNouveau code : ${newCode}\n\nUtilisez ce nouveau code pour vos prochaines recommandations.`,
                                              ctaUrl: 'https://edukaraib.com/influencer/dashboard',
                                              ctaText: 'Voir mon tableau de bord',
                                            }),
                                          });
                                        }
                                        setInfluCodeEdit(null);
                                      } catch (err) {
                                        alert('Erreur : ' + err.message);
                                      } finally {
                                        setInfluCodeSaving(false);
                                      }
                                    }
                                    if (e.key === 'Escape') setInfluCodeEdit(null);
                                  }}
                                />
                                <button
                                  disabled={influCodeSaving || !influCodeInput.trim()}
                                  title="Valider"
                                  className="text-xs bg-primary text-white px-2 py-1 rounded disabled:opacity-40 hover:bg-primary-dark"
                                  onClick={async () => {
                                    const newCode = influCodeInput.trim().toUpperCase();
                                    if (!newCode) return;
                                    setInfluCodeSaving(true);
                                    try {
                                      await updateDoc(doc(db, 'influencers', influ.id), { code: newCode });
                                      setInfluencers(prev => prev.map(i =>
                                        i.id === influ.id ? { ...i, code: newCode } : i
                                      ));
                                      // ✉️ Email de notification à l'influenceur
                                      if (influ.email) {
                                        await fetchWithAuth('/api/notify-email', {
                                          method: 'POST',
                                          body: JSON.stringify({
                                            to: influ.email,
                                            title: 'Votre code promo a été modifié',
                                            message: `Bonjour ${influ.name || ''},\n\nVotre code promo a été mis à jour par l'équipe EduKaraib.\n\nNouveau code : ${newCode}\n\nUtilisez ce nouveau code pour vos prochaines recommandations.`,
                                            ctaUrl: 'https://edukaraib.com/influencer/dashboard',
                                            ctaText: 'Voir mon tableau de bord',
                                          }),
                                        });
                                      }
                                      setInfluCodeEdit(null);
                                    } catch (err) {
                                      alert('Erreur : ' + err.message);
                                    } finally {
                                      setInfluCodeSaving(false);
                                    }
                                  }}
                                >
                                  {influCodeSaving ? '…' : '✓'}
                                </button>
                                <button
                                  title="Annuler"
                                  className="text-xs text-gray-400 hover:text-gray-600 px-1"
                                  onClick={() => setInfluCodeEdit(null)}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{influ.code}</span>
                                <button
                                  className="text-gray-400 hover:text-gray-700 text-xs"
                                  title="Copier le code"
                                  onClick={() => navigator.clipboard.writeText(influ.code)}
                                >
                                  📋
                                </button>
                                <button
                                  className="text-gray-400 hover:text-primary text-xs"
                                  title="Modifier le code promo"
                                  onClick={() => {
                                    setInfluCodeEdit(influ.id);
                                    setInfluCodeInput(influ.code || '');
                                  }}
                                >
                                  ✏️
                                </button>
                              </div>
                            )}
                          </td>

                          <td className="p-3 text-right text-gray-700">{influ.usageCount || 0}</td>
                          <td className="p-3 text-right font-medium text-emerald-700">
                            {(influ.totalEarned || 0).toFixed(2)} €
                          </td>
                          <td className="p-3 text-right">
                            <span className={`font-semibold ${(influ.pendingPayout || 0) > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                              {(influ.pendingPayout || 0).toFixed(2)} €
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${influ.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                              {influ.active !== false ? 'Actif' : 'Inactif'}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              {/* Bouton virer */}
                              <button
                                disabled={!(influ.pendingPayout > 0) || !influ.rib || influPayoutLoading === influ.id}
                                className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-emerald-700"
                                title={!influ.rib ? "Pas d'IBAN enregistré" : `Virer ${(influ.pendingPayout || 0).toFixed(2)} €`}
                                onClick={async () => {
                                  const _maskedRib = influ.rib ? influ.rib.slice(0,4) + '••••' + influ.rib.slice(-4) : 'N/A';
                                  if (!window.confirm(`Virer ${(influ.pendingPayout || 0).toFixed(2)} € à ${influ.name} ?\nIBAN: ${_maskedRib}`)) return;
                                  setInfluPayoutLoading(influ.id);
                                  try {
                                    const data = await fetchWithAuth('/api/trigger-influencer-payout', {
                                      method: 'POST',
                                      body: JSON.stringify({ influencerUid: influ.id }),
                                    });
                                    if (!data?.success) {
                                      const detail = data?.detail ? '\n\nDétail Stripe : ' + data.detail : '';
                                      throw new Error((data?.error || 'Erreur') + detail);
                                    }
                                    alert(`✅ Virement de ${data.amount_eur} € déclenché pour ${data.name}\nStripe ID : ${data.stripe_payout_id}`);
                                    setInfluencers(prev => prev.map(i =>
                                      i.id === influ.id ? { ...i, pendingPayout: 0 } : i
                                    ));
                                  } catch (e) {
                                    alert('❌ ' + e.message);
                                  } finally {
                                    setInfluPayoutLoading(null);
                                  }
                                }}
                              >
                                {influPayoutLoading === influ.id ? '…' : '💸 Virer'}
                              </button>

                              {/* Bouton activer/désactiver */}
                              <button
                                disabled={influToggleLoading === influ.id}
                                className={`text-xs px-3 py-1.5 rounded-lg border ${influ.active !== false ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
                                onClick={async () => {
                                  setInfluToggleLoading(influ.id);
                                  try {
                                    const newActive = influ.active === false ? true : false;
                                    await updateDoc(doc(db, 'influencers', influ.id), { active: newActive });
                                    setInfluencers(prev => prev.map(i =>
                                      i.id === influ.id ? { ...i, active: newActive } : i
                                    ));
                                  } catch (e) {
                                    alert('Erreur: ' + e.message);
                                  } finally {
                                    setInfluToggleLoading(null);
                                  }
                                }}
                              >
                                {influ.active !== false ? 'Désactiver' : 'Réactiver'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {influencers.filter(i => {
                      if (influFilter === 'pending' && !(i.pendingPayout > 0)) return false;
                      if (influFilter === 'inactive' && i.active !== false) return false;
                      return true;
                    }).length === 0 && (
                      <tr><td colSpan={7} className="p-8 text-center text-gray-400">Aucun influenceur trouvé.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ===========================
   SiteVisitsSection — sous-composants (hors fonction)
=========================== */

function VisitBarChart({ data, showEvery }) {
  if (!data || data.length === 0) return null;
  var maxPV = 1;
  data.forEach(function(d) {
    if ((Number(d.pageviews) || 0) > maxPV) maxPV = Number(d.pageviews) || 0;
  });
  var W = 600;
  var H = 100;
  var padL = 8;
  var padR = 8;
  var barW = Math.max(2, Math.floor((W - padL - padR) / data.length) - 1);
  return (
    <svg viewBox={"0 0 " + W + " " + (H + 24)} className="w-full">
      {data.map(function(d, i) {
        var pvH  = Math.max(2, Math.round((Number(d.pageviews)  || 0) / maxPV * H));
        var visH = Math.max(2, Math.round((Number(d.visitors) || 0) / maxPV * H));
        var x = padL + i * ((W - padL - padR) / data.length);
        var showLabel = data.length <= 12 || i % showEvery === 0;
        return (
          <g key={i}>
            <rect x={x} y={H - pvH}  width={barW} height={pvH}  rx={1} fill="#3b82f6" opacity={0.8} />
            <rect x={x} y={H - visH} width={Math.max(1, barW - 2)} height={visH} rx={1} fill="#10b981" opacity={0.7} />
            {showLabel && (
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={7} fill="#9ca3af">
                {String(d.day || d.month || '').slice(-5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, colors }) {
  var COLORS = colors || ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
  var total = 0;
  data.forEach(function(d) { total += d.value; });
  if (!total) return <div className="text-xs text-gray-400 py-4 text-center">Aucune donnée</div>;
  var offset = 0;
  var R = 40;
  var CX = 55;
  var CY = 55;
  var slices = data.slice(0, 8).map(function(d, i) {
    var pct = d.value / total;
    var startA = offset * 2 * Math.PI - Math.PI / 2;
    offset += pct;
    var endA = offset * 2 * Math.PI - Math.PI / 2;
    var x1 = CX + R * Math.cos(startA);
    var y1 = CY + R * Math.sin(startA);
    var x2 = CX + R * Math.cos(endA);
    var y2 = CY + R * Math.sin(endA);
    var large = pct > 0.5 ? 1 : 0;
    var pathD = "M " + CX + " " + CY + " L " + x1 + " " + y1 + " A " + R + " " + R + " 0 " + large + " 1 " + x2 + " " + y2 + " Z";
    return { pathD, color: COLORS[i % COLORS.length], label: d.label, value: d.value, pct };
  });
  return (
    <svg viewBox="0 0 200 110" className="w-full max-w-[200px]">
      {slices.map(function(s, i) {
        return <path key={i} d={s.pathD} fill={s.color} />;
      })}
      <circle cx={CX} cy={CY} r={22} fill="white" />
      {slices.map(function(s, i) {
        return (
          <g key={i}>
            <rect x={110} y={4 + i * 13} width={8} height={8} rx={2} fill={s.color} />
            <text x={122} y={12 + i * 13} fontSize={7} fill="#374151">
              {s.label} ({Math.round(s.pct * 100)}%)
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SiteVisitsSection() {
  const [visitData, setVisitData] = useState(null);
  const [visitLoading, setVisitLoading] = useState(true);
  const [visitError, setVisitError] = useState(null);
  const [visitPeriod, setVisitPeriod] = useState('30d');

  useEffect(() => {
    setVisitLoading(true);
    setVisitError(null);
    fetchWithAuth(`/api/analytics?period=${visitPeriod}`)
      .then(data => {
        setVisitData(data);
        setVisitLoading(false);
      })
      .catch(err => {
        setVisitError(err.message || 'Erreur');
        setVisitLoading(false);
      });
  }, [visitPeriod]);

  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold">🌐 Visites du site (Vercel Analytics)</div>
        <div className="flex gap-1">
          {['7d','30d','90d'].map(p => (
            <button
              key={p}
              className={`px-3 py-1 rounded text-xs border ${visitPeriod === p ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600'}`}
              onClick={() => setVisitPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {visitLoading && <div className="text-gray-400 text-sm py-4 text-center">Chargement des analytics…</div>}
      {visitError && <div className="text-red-500 text-sm py-4 text-center">Erreur : {visitError}</div>}

      {!visitLoading && !visitError && visitData && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Pageviews', value: visitData.summary?.pageviews ?? '—', color: 'text-blue-600' },
              { label: 'Visiteurs uniques', value: visitData.summary?.visitors ?? '—', color: 'text-emerald-600' },
              { label: 'Sessions', value: visitData.summary?.sessions ?? '—', color: 'text-purple-600' },
              { label: 'Taux de rebond', value: visitData.summary?.bounceRate != null ? Math.round(visitData.summary.bounceRate * 100) + '%' : '—', color: 'text-orange-600' },
            ].map(k => (
              <div key={k.label} className="bg-gray-50 border rounded-lg p-3">
                <div className="text-xs text-gray-500">{k.label}</div>
                <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Graphique journalier */}
          {visitData.timeseries && visitData.timeseries.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1 flex gap-3">
                <span><span className="inline-block w-2 h-2 rounded bg-blue-500 mr-1" />Pageviews</span>
                <span><span className="inline-block w-2 h-2 rounded bg-emerald-500 mr-1" />Visiteurs</span>
              </div>
              <VisitBarChart
                data={visitData.timeseries}
                showEvery={visitData.timeseries.length > 30 ? 7 : visitData.timeseries.length > 14 ? 3 : 1}
              />
            </div>
          )}

          {/* Top pages + pays */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visitData.topPages && visitData.topPages.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">Top pages</div>
                <ul className="space-y-1">
                  {visitData.topPages.slice(0, 8).map((p, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400 w-4">{i+1}.</span>
                      <span className="flex-1 truncate text-gray-700 font-mono">{p.page}</span>
                      <span className="text-blue-600 font-semibold">{p.pageviews}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {visitData.countries && visitData.countries.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">Pays</div>
                <DonutChart
                  data={visitData.countries.slice(0, 6).map(c => ({ label: c.country, value: c.visitors }))}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================
   StatsTab — sous-composant (hors fonction principale)
=========================== */
function StatsTab({ users, payments, lessons, lessonsLoading }) {
  const toDate = (ts) => {
    try {
      if (!ts) return null;
      if (ts?.toDate) return ts.toDate();
      return new Date(ts);
    } catch { return null; }
  };
  const monthKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : null;
  const monthLabel = (k) => {
    const [y, m] = k.split('-');
    return new Date(Number(y), Number(m)-1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  };

  const last6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  const signupsByMonth = useMemo(() => {
    const counts = {};
    users.forEach(u => {
      const d = toDate(u.createdAt);
      const k = monthKey(d);
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return last6.map(k => ({ label: monthLabel(k), value: counts[k] || 0 }));
  }, [users]);

  const lessonsByMonth = useMemo(() => {
    const counts = {};
    lessons.forEach(l => {
      const d = toDate(l.created_at || l.start_datetime);
      const k = monthKey(d);
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return last6.map(k => ({ label: monthLabel(k), value: counts[k] || 0 }));
  }, [lessons]);

  const revenueByMonth = useMemo(() => {
    const sums = {};
    payments.filter(p => p.status === 'held' || p.status === 'released').forEach(p => {
      const d = toDate(p.created_at);
      const k = monthKey(d);
      if (k) sums[k] = (sums[k] || 0) + Number(p.gross_eur || 0);
    });
    return last6.map(k => ({ label: monthLabel(k), value: Math.round(sums[k] || 0) }));
  }, [payments]);

  const totalUsers       = users.length;
  const totalTeachers    = users.filter(u => u.role === 'teacher').length;
  const totalStudents    = users.filter(u => u.role === 'student').length;
  const totalParents     = users.filter(u => u.role === 'parent').length;
  const totalInfluencers = users.filter(u => u.role === 'influencer').length;
  const totalLessons   = lessons.length;
  const completedLessons = lessons.filter(l => l.status === 'completed').length;
  const paidLessons    = lessons.filter(l => l.is_paid).length;
  const totalRevenue   = payments
    .filter(p => p.status === 'held' || p.status === 'released')
    .reduce((a, p) => a + Number(p.gross_eur || 0), 0);
  const totalFees      = payments
    .filter(p => p.status === 'held' || p.status === 'released')
    .reduce((a, p) => a + Number(p.fee_eur || 0), 0);

  const thisMonth = monthKey(new Date());
  const newThisMonth = users.filter(u => monthKey(toDate(u.createdAt)) === thisMonth).length;

  const BarChart = ({ data, color = '#00804B', unit = '' }) => {
    const max = Math.max(...data.map(d => d.value), 1);
    const W = 400, H = 120, pad = 30, barW = Math.floor((W - pad * 2) / data.length) - 4;
    return (
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full">
        {data.map((d, i) => {
          const x = pad + i * ((W - pad * 2) / data.length) + 2;
          const barH = Math.max(4, Math.round((d.value / max) * H));
          return (
            <g key={i}>
              <rect x={x} y={H - barH} width={barW} height={barH} rx={3} fill={color} opacity={0.85} />
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="#6b7280">{d.label}</text>
              {d.value > 0 && (
                <text x={x + barW / 2} y={H - barH - 4} textAnchor="middle" fontSize={9} fill={color} fontWeight="bold">
                  {d.value}{unit}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  if (lessonsLoading) {
    return <div className="text-gray-500 py-10 text-center">Chargement des stats…</div>;
  }

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Utilisateurs', value: totalUsers, sub: `+${newThisMonth} ce mois`, color: 'text-blue-600' },
          { label: 'Profs', value: totalTeachers, sub: `${totalStudents} élèves · ${totalParents} parents · ${totalInfluencers} influenceurs`, color: 'text-emerald-600' },
          { label: 'Cours créés', value: totalLessons, sub: `${completedLessons} terminés · ${paidLessons} payés`, color: 'text-purple-600' },
          { label: 'Revenu plateforme', value: `${totalFees.toFixed(0)} €`, sub: `Brut total ${totalRevenue.toFixed(0)} €`, color: 'text-green-700' },
        ].map(k => (
          <div key={k.label} className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-xs text-gray-400 mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Répartition rôles */}
      <div className="bg-white border rounded-xl p-4">
        <div className="font-semibold mb-3">Répartition des comptes</div>
        <div className="flex gap-4 flex-wrap">
          {[
            { label: 'Profs',        count: totalTeachers,    color: 'bg-emerald-500' },
            { label: 'Élèves',       count: totalStudents,    color: 'bg-blue-500'    },
            { label: 'Parents',      count: totalParents,     color: 'bg-purple-500'  },
            { label: 'Influenceurs', count: totalInfluencers, color: 'bg-pink-500'    },
          ].map(r => (
            <div key={r.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${r.color}`} />
              <span className="text-sm font-medium">{r.label}</span>
              <span className="text-sm text-gray-500">{r.count}</span>
              <span className="text-xs text-gray-400">
                ({totalUsers > 0 ? Math.round(r.count / totalUsers * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex rounded-full overflow-hidden h-3">
          {totalTeachers    > 0 && <div className="bg-emerald-500" style={{ width: `${totalTeachers/totalUsers*100}%` }} />}
          {totalStudents    > 0 && <div className="bg-blue-500"    style={{ width: `${totalStudents/totalUsers*100}%` }} />}
          {totalParents     > 0 && <div className="bg-purple-500"  style={{ width: `${totalParents/totalUsers*100}%` }} />}
          {totalInfluencers > 0 && <div className="bg-pink-500"    style={{ width: `${totalInfluencers/totalUsers*100}%` }} />}
        </div>
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4">
          <div className="font-semibold text-sm mb-2 text-blue-700">📈 Nouveaux inscrits / mois</div>
          <BarChart data={signupsByMonth} color="#3b82f6" />
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="font-semibold text-sm mb-2 text-purple-700">📚 Cours créés / mois</div>
          <BarChart data={lessonsByMonth} color="#8b5cf6" />
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="font-semibold text-sm mb-2 text-emerald-700">💶 Revenus bruts / mois (€)</div>
          <BarChart data={revenueByMonth} color="#00804B" unit="€" />
        </div>
      </div>

      {/* Visites du site */}
      <SiteVisitsSection />

      {/* Derniers inscrits */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="p-3 border-b font-semibold">🆕 Derniers inscrits</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Nom</th>
              <th className="p-2 text-left">Rôle</th>
              <th className="p-2 text-left">Ville</th>
              <th className="p-2 text-left">Inscrit le</th>
            </tr>
          </thead>
          <tbody>
            {[...users]
              .sort((a, b) => {
                const da = toDate(a.createdAt)?.getTime() || 0;
                const db_ = toDate(b.createdAt)?.getTime() || 0;
                return db_ - da;
              })
              .slice(0, 10)
              .map(u => (
                <tr key={u.id} className="border-t">
                  <td className="p-2 font-medium">{nameOf(u)}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      u.role === 'teacher'    ? 'bg-emerald-100 text-emerald-700' :
                      u.role === 'parent'     ? 'bg-purple-100 text-purple-700'  :
                      u.role === 'influencer' ? 'bg-pink-100 text-pink-700'      :
                      'bg-blue-100 text-blue-700'
                    }`}>{u.role}</span>
                  </td>
                  <td className="p-2 text-gray-500">{u.city || '—'}</td>
                  <td className="p-2 text-gray-500">{toDateStr(u.createdAt)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
