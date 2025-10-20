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
import { sendPasswordResetEmail } from 'firebase/auth';
import { Link } from 'react-router-dom';
import fetchWithAuth from '../utils/fetchWithAuth';
import React, { useEffect, useMemo, useState } from 'react';

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
            • Si le paiement n’a pas encore été reversé au prof, un <b>refund</b> simple est créé. <br />
            • S’il a déjà été reversé, on fait un <b>reverse transfer</b> côté Stripe, puis un refund côté client si nécessaire.
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

/* ===========================
   AdminDashboard (sans layout)
=========================== */
export default function AdminDashboard() {
  const [tab, setTab] = useState('accounts'); // accounts | payments | messages
  const [meRole, setMeRole] = useState(null);

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
  const [dateFrom, setDateFrom] = useState(''); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState('');   // YYYY-MM-DD

  // --- Refund modal ---
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundTeacherName, setRefundTeacherName] = useState('');

  // --- Messages state ---
  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  /* ----- Load current user & role ----- */
  useEffect(() => {
    const cur = auth.currentUser;
    if (!cur) return;
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

  /* ----- Derived: account filters ----- */
  const filteredUsers = useMemo(() => {
    const t = (search || '').toLowerCase().trim();
    return users.filter((u) => {
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

  /* ----- Derived: payments summaries ----- */
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
     Messaging (broadcast)
  =========================== */
  const sendMessage = async (audience) => {
    let targets = [];
    if (audience === 'selected') {
      targets = filteredUsers.filter((u) => selectedIds.has(u.id));
    } else if (audience === 'filtered') {
      targets = filteredUsers;
    } else {
      targets = users;
    }

    if (!messageTitle.trim() || !messageBody.trim()) {
      return alert('Titre et message requis.');
    }
    if (!window.confirm(`Envoyer ce message à ${targets.length} compte(s) ?`)) return;

    try {
      let sent = 0;
      for (const u of targets) {
        await addDoc(collection(db, 'notifications'), {
          user_id: u.id,
          read: false,
          created_at: serverTimestamp(),
          type: 'admin_broadcast',
          title: messageTitle.trim(),
          message: messageBody.trim(),
          from_admin: auth.currentUser?.uid || null,
        });
        sent += 1;
      }
      alert(`Message envoyé à ${sent} compte(s).`);
      setMessageTitle('');
      setMessageBody('');
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      alert("Échec de l'envoi de message.");
    }
  };

  /* ===========================
     Guards
  =========================== */
  if (meRole && meRole !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header minimal */}
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
      {/* Header minimal avec lien vers accueil */}
      <header className="w-full bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold text-primary hover:underline">EduKaraib</Link>
          <div className="text-xs text-gray-500">Admin</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-primary mb-4">Tableau de bord Administrateur</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
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
                          <span className="px-2 py-0.5 rounded bg-gray-100">{u.role || 'n/a'}</span>
                          <select
                            className="border rounded px-1 py-0.5 text-xs"
                            value={u.role || 'student'}
                            onChange={(e) => setRole(u, e.target.value)}
                          >
                            <option value="student">student</option>
                            <option value="parent">parent</option>
                            <option value="teacher">teacher</option>
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
                          {/* Messagerie standard */}
                          <Link
                            to={`/chat/${u.id}`}
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
            {/* Filters */}
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
                <div className="text-xl font-bold">{fmtMoney(totals.paid)}</div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-gray-500 text-sm">Remboursés</div>
                <div className="text-xl font-bold">{fmtMoney(totals.refunded)}</div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-gray-500 text-sm">Revenu net</div>
                <div className="text-xl font-bold">{fmtMoney(totals.net)}</div>
              </div>
            </div>

            {/* Per-teacher aggregation */}
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
                  {!payLoading && perTeacher.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-gray-400">Aucune donnée</td></tr>
                  )}
                  {!payLoading && perTeacher.map((row) => {
                    const t = teacherMap.get(row.teacher_id);
                    return (
                      <tr key={row.teacher_id} className="border-t">
                        <td className="p-2">{t ? nameOf(t) : row.teacher_id}</td>
                        <td className="p-2 text-right">{fmtMoney(row.paid)}</td>
                        <td className="p-2 text-right text-amber-700">{fmtMoney(row.refunded)}</td>
                        <td className="p-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Details tables */}
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

        {/* === MESSAGES TAB === */}
        {tab === 'messages' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Composer (broadcast notifications) */}
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
                <button
                  className="px-4 py-2 rounded bg-primary text-white hover:bg-primary-dark disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || selectedIds.size === 0}
                  onClick={() => sendMessage('selected')}
                >
                  Envoyer aux sélectionnés ({selectedIds.size})
                </button>
                <button
                  className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-black disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || filteredUsers.length === 0}
                  onClick={() => sendMessage('filtered')}
                >
                  Envoyer à la liste filtrée ({filteredUsers.length})
                </button>
                <button
                  className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-60"
                  disabled={messageSending || !messageTitle.trim() || !messageBody.trim() || users.length === 0}
                  onClick={() => sendMessage('all')}
                >
                  Envoyer à tous ({users.length})
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Diffusion via <code>notifications</code>. Pour un échange direct, utilise <b>Contacter</b> dans l’onglet Comptes (ouvre le chat).
              </p>
            </div>

            {/* Aperçu destinataires (selon l’onglet Comptes + filtres/selection) */}
            <div className="bg-white border rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-3">Destinataires (aperçu)</h3>
              <div className="text-sm text-gray-600 mb-2">
                Filtre : <b>{roleFilter}</b>, Recherche : <b>{search || '—'}</b>
              </div>
              <div className="max-h-[400px] overflow-auto divide-y">
                {filteredUsers.slice(0, 200).map((u) => (
                  <div key={`dest:${u.id}`} className="py-2 flex items-center gap-2">
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
                      to={`/chat/${u.id}`}
                      className="text-xs px-2 py-1 rounded bg-primary text-white hover:bg-primary-dark"
                    >
                      Contacter
                    </Link>
                  </div>
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
      </main>
    </div>
  );
}
