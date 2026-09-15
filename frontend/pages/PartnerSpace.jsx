import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fetchWithAuth from '../utils/fetchWithAuth';
import { partnerGridRows, partnerShareLink, partnerShareMessage, isPartnerModel } from '../lib/partner';
import { PARTNER_ROLE } from '../../api/_partners.mjs';

const fmtEur = (n) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}
const TYPE_LABELS = { unitaire: 'Cours', pack5: 'Pack 5 h', pack10: 'Pack 10 h' };

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copié`);
  } catch {
    toast.error('Copie impossible : sélectionnez le texte à la main.');
  }
}

function Card({ title, children }) {
  return (
    <section className="bg-white rounded-xl shadow p-5 mb-6">
      <h3 className="font-bold text-primary mb-4">{title}</h3>
      {children}
    </section>
  );
}

/** Reversements : compte Stripe Connect du partenaire (comme les profs). */
function PayoutSetup({ stripe, pending, onOpen, opening }) {
  let text;
  let label;
  if (stripe?.transfers_active) {
    text = 'Compte bancaire connecté. Vos reversements partent automatiquement, 7 jours après chaque cours payé.';
    label = 'Gérer mon compte Stripe';
  } else if (stripe?.connected && !stripe?.details_submitted) {
    text = 'Votre configuration Stripe n’est pas terminée : vos reversements ne peuvent pas encore partir.';
    label = 'Terminer ma configuration';
  } else if (stripe?.connected) {
    text = 'Stripe vérifie vos informations (de quelques minutes à 2 jours). Les reversements partiront dès la vérification terminée.';
    label = 'Ouvrir mon compte Stripe';
  } else {
    text = 'Pour recevoir vos reversements, connectez le compte bancaire de votre structure. Cela prend 2 minutes, via Stripe, notre prestataire de paiement (le même que pour nos professeurs).';
    label = 'Recevoir mes reversements';
  }
  return (
    <div className="space-y-3">
      <p className={`text-sm ${stripe?.transfers_active ? 'text-emerald-700 font-medium' : 'text-gray-600'}`}>{text}</p>
      {!stripe?.transfers_active && pending > 0 && (
        <p className="text-sm font-semibold text-amber-700">{fmtEur(pending)} vous attendent déjà.</p>
      )}
      <button type="button" onClick={onOpen} disabled={opening} className="bg-primary hover:bg-primary-dark text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50">
        {opening ? 'Ouverture de Stripe…' : label}
      </button>
    </div>
  );
}

export default function PartnerSpace() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [partner, setPartner] = useState(null);
  const [stripe, setStripe] = useState(null);
  const [stripeOpening, setStripeOpening] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/partenaire', { replace: true }); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists() || snap.data()?.role !== PARTNER_ROLE) {
        await signOut(auth);
        navigate('/partenaire', { replace: true });
        return;
      }
      setUid(user.uid);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [navigate]);

  // La fiche partenaire vit dans la collection historique `influencers`
  const loadPartner = useCallback(async (currentUid) => {
    let snap = await getDoc(doc(db, 'influencers', currentUid));
    if (!snap.exists()) {
      const q = await getDocs(query(collection(db, 'influencers'), where('uid', '==', currentUid)));
      if (!q.empty) snap = q.docs[0];
    }
    if (snap?.exists()) setPartner({ id: snap.id, ...snap.data() });
  }, []);

  useEffect(() => {
    if (!uid) return;
    loadPartner(uid);
    fetchWithAuth('/api/partner-connect').then(setStripe).catch(() => setStripe(null));
  }, [uid, loadPartner]);

  const openStripe = async () => {
    setStripeOpening(true);
    try {
      const data = await fetchWithAuth('/api/partner-connect', { method: 'POST' });
      // location.assign et pas window.open : après un await, window.open est bloqué sur mobile
      window.location.assign(data.url);
    } catch (e) {
      toast.error(`Impossible d’ouvrir Stripe : ${e.message}`);
      setStripeOpening(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const code = partner?.code || '';
  const name = partner?.name || '';
  const conversions = partner?.conversions || [];
  const payouts = partner?.payoutHistory || [];
  const pending = Math.max(0, Number(partner?.pendingPayout || 0));
  const alreadyPaid = payouts.reduce((s, p) => s + Number(p.amount_eur || 0), 0);
  const families = partner?.familiesCount ?? new Set(conversions.map((c) => c.payer_uid).filter(Boolean)).size;
  const link = partnerShareLink(code);
  const message = partnerShareMessage({ code, structureName: name });

  return (
    <DashboardLayout role="influencer">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary mb-1">Espace partenaire</h2>
        <p className="text-gray-600">{name}</p>
      </div>

      {partner && partner.active !== true && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
          Votre code est suspendu. Écrivez-nous à contact@edukaraib.com.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Familles rattachées', value: families },
          { label: 'Cours payés', value: conversions.length },
          { label: 'À vous reverser', value: fmtEur(pending) },
          { label: 'Déjà reversé', value: fmtEur(alreadyPaid) },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow p-4 border-l-4 border-primary">
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className="text-2xl font-extrabold text-primary mt-1">{k.value}</div>
          </div>
        ))}
      </div>

      <Card title="Votre code et votre lien">
        {code ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-2xl font-extrabold text-primary tracking-widest bg-gray-50 border border-gray-200 rounded-xl px-5 py-3">{code}</span>
              <button type="button" onClick={() => copy(code, 'Code')} className="text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 hover:border-primary hover:text-primary">Copier le code</button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 break-all">{link}</span>
              <button type="button" onClick={() => copy(link, 'Lien')} className="text-sm font-semibold px-4 py-2.5 rounded-xl border border-gray-200 hover:border-primary hover:text-primary">Copier le lien</button>
            </div>
            <p className="text-xs text-gray-500">
              La famille qui passe par ce lien, ou qui saisit le code au paiement, y reste rattachée : la remise s’applique ensuite toute seule, pour tous ses enfants.
              {isPartnerModel(partner) && partner?.expires_at && <> Valable jusqu’au {fmtDate(partner.expires_at)}.</>}
            </p>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Code en cours de création : rechargez la page dans un instant.</p>
        )}
      </Card>

      <Card title="Recevoir vos reversements">
        <PayoutSetup stripe={stripe} pending={pending} onOpen={openStripe} opening={stripeOpening} />
      </Card>

      {code && (
        <Card title="Message prêt à transférer aux familles">
          <textarea readOnly value={message} rows={9} className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 bg-gray-50" />
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={() => copy(message, 'Message')} className="text-sm font-semibold px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary-dark">Copier le message</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 hover:border-primary">Envoyer sur WhatsApp</a>
            <a href={`mailto:?subject=${encodeURIComponent(`Cours particuliers à tarif réduit avec ${name}`)}&body=${encodeURIComponent(message)}`} className="text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 hover:border-primary">Envoyer par mail</a>
          </div>
        </Card>
      )}

      <Card title="Ce que reçoivent vos familles et votre structure">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {partnerGridRows(partner).map((r) => (
            <div key={r.type} className="rounded-xl border border-gray-200 p-3">
              <div className="text-xs text-gray-500 mb-1">{r.type}</div>
              <div className="text-lg font-extrabold text-primary">{r.partenaire} pour vous</div>
              <div className="text-xs text-gray-500">{r.famille} pour la famille</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">Les packs de 10 h rapportent le plus à votre structure : mettez-les en avant auprès de vos familles.</p>
      </Card>

      <Card title="Cours payés par vos familles">
        {conversions.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Aucun cours payé pour l’instant. Transférez le message ci-dessus à vos familles.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
                <th className="pb-2">Date</th><th className="pb-2">Achat</th><th className="pb-2 text-right">Pour vous</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...conversions].reverse().map((c, i) => (
                  <tr key={c.session_id || `${i}`}>
                    <td className="py-2.5 text-gray-500">{fmtDate(c.paid_at)}</td>
                    <td className="py-2.5">{TYPE_LABELS[c.type] || c.type || '—'}{c.refunded_eur ? ' (remboursé)' : ''}</td>
                    <td className="py-2.5 text-right font-bold text-primary">+{fmtEur(Number(c.amount_eur || 0) - Number(c.refunded_eur || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Reversements reçus">
        {payouts.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Aucun reversement pour l’instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
                <th className="pb-2">Date</th><th className="pb-2">Montant</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...payouts].reverse().map((p, i) => (
                  <tr key={p.transfer_id || `${i}-${p.amount_eur}`}>
                    <td className="py-2.5 text-gray-500">{fmtDate(p.triggered_at)}</td>
                    <td className="py-2.5 font-bold">{fmtEur(p.amount_eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </DashboardLayout>
  );
}
