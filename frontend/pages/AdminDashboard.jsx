import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
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
   AdminDashboard
=========================== */
export default function AdminDashboard() {
  const [tab, setTab] = useState('accounts'); // accounts | payments | messages
  const [me, setMe] = useState(null);
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

  // --- Messages state ---
  const [messageTitle, setMessageTitle] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  /* ----- Load current user & role ----- */
  useEffect(() => {
    const cur = auth.currentUser;
    if (!cur) return;
    setMe(cur);
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

      // Optional date filtering (client-side to keep code simple)
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
      const s = [
        u.email,
        nameOf(u),
        u.city,
        u.role,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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
    // Aggregate net by teacher: (sum succeeded for teacher) - (sum refunds for teacher)
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
      alert('Impossible denvoyer le reset password.');
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
     Messaging
  =========================== */
  const sendMessage = async (audience) => {
    // audience: 'selected' | 'filtered' | 'all'
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

    setMessageSending(true);
    try {
      const batchSize = Math.min(500, targets.length); // simple protection
      let sent = 0;
      for (let i = 0; i < targets.length; i += batchSize) {
        const chunk = targets.slice(i, i + batchSize);
        // Envoi séquentiel simple (remplacer par Cloud Function si besoin)
        // notifications: { user_id, title, body, read:false, created_at, type:'admin_broadcast' }
        // Peut être étendu pour push/SMS/email
        /* eslint-disable no-await-in-loop */
        for (const u of chunk) {
          await addDoc(collection(db, 'notifications'), {
            user_id: u.id,
            read: false,
            created_at: serverTimestamp(),
            type: 'admin_broadcast',
            title: messageTitle.trim(),
            message: messageBody.trim(),
            from_admin: me?.uid || null,
          });
          sent += 1;
        }
        /* eslint-enable no-await-in-loop */
      }
      alert(`Message envoyé à ${sent} compte(s).`);
      setMessageTitle('');
      setMessageBody('');
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      alert("Échec de l'envoi de message.");
    } finally {
      setMessageSending(false);
    }
  };

  /* ===========================
     Guards
  =========================== */
  if (meRole && meRole !== 'admin') {
    return (
      <DashboardLayout role="admin">
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Accès refusé. Votre rôle doit être <b>admin</b>.
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /* ===========================
     UI
  =========================== */
  return (
    <DashboardLayout role="admin">
      <div className="max-w-7xl mx-auto p-6">
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
                    </tr>
                  </thead>
                  <tbody>
                    {payLoading && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-500">Chargement…</td></tr>
                    )}
                    {!payLoading && payments.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-400">Aucun paiement</td></tr>
                    )}
                    {!payLoading && payments.map((p) => {
                      const t = teacherMap.get(p.teacher_id);
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
          </div>
        )}

        {/* === MESSAGES TAB === */}
        {tab === 'messages' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Composer */}
            <div className="lg:col-span-2 bg-white border rounded-xl p-4">
              <h3 className="text-lg font-semibold mb-3">Envoyer un message</h3>
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
                Les messages sont créés dans la collection <code>notifications</code> avec <code>type: 'admin_broadcast'</code>.
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
      </div>
    </DashboardLayout>
  );
}