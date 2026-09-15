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

function Card({ title, children, right }) {
  return (
    <section className="bg-white rounded-xl shadow p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="font-bold text-primary">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function PartnerSpace() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState(null);
  const [partner, setPartner] = useState(null);

  const [ibanInput, setIbanInput] = useState('');
  const [ibanEdit, setIbanEdit] = useState(false);
  const [ibanSaving, setIbanSaving] = useState(false);

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
    if (snap?.exists()) {
      const data = { id: snap.id, ...snap.data() };
      setPartner(data);
      setIbanInput(data.rib || '');
    }
  }, []);

  useEffect(() => { if (uid) loadPartner(uid); }, [uid, loadPartner]);

  const saveIban = async () => {
    setIbanSaving(true);
    try {
      const data = await fetchWithAuth('/api/partner-iban', { method: 'POST', body: JSON.stringify({ iban: ibanInput }) });
      setPartner((p) => ({ ...p, rib: data.rib }));
      setIbanEdit(false);
      toast.success('IBAN enregistré.');
    } catch (e) {
      toast.error(e.message === 'INVALID_IBAN' ? 'IBAN invalide : vérifiez les chiffres.' : `Erreur : ${e.message}`);
    } finally {
      setIbanSaving(false);
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
  const pending = Number(partner?.pendingPayout || 0);
  const alreadyPaid = Math.max(0, Number(partner?.totalEarned || 0) - pending);
  const families = partner?.familiesCount ?? new Set(conversions.map((c) => c.payer_uid).filter(Boolean)).size;
  const link = partnerShareLink(code);
  const message = partnerShareMessage({ code, structureName: name });
  const newModel = isPartnerModel(partner);

  return (
    <DashboardLayout role="influencer">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary mb-1">Espace partenaire</h2>
        <p className="text-gray-600">{name}</p>
      </div>

      {partner?.pending_review && partner?.active !== true && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-6 text-sm">
          Votre demande est en cours de validation (sous 24 h). Votre code sera actif dès la validation ; vous recevrez un mail.
        </div>
      )}
      {!partner?.pending_review && partner && partner.active !== true && (
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
              {newModel && partner?.expires_at && <> Valable jusqu’au {fmtDate(partner.expires_at)}.</>}
            </p>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Code en cours de création : rechargez la page dans un instant.</p>
        )}
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
                    <td className="py-2.5">{TYPE_LABELS[c.type] || c.type || '—'}</td>
                    <td className="py-2.5 text-right font-bold text-primary">+{fmtEur(c.amount_eur)}</td>
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
                <th className="pb-2">Date</th><th className="pb-2">Montant</th><th className="pb-2">Compte</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...payouts].reverse().map((p, i) => (
                  <tr key={`${i}-${p.amount_eur}`}>
                    <td className="py-2.5 text-gray-500">{fmtDate(p.triggered_at)}</td>
                    <td className="py-2.5 font-bold">{fmtEur(p.amount_eur)}</td>
                    <td className="py-2.5 font-mono text-xs text-gray-500">{p.iban_masked || (p.iban ? `${p.iban.slice(0, 4)} •••• ${p.iban.slice(-4)}` : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="IBAN de votre structure"
        right={partner?.rib && !ibanEdit && (
          <button type="button" onClick={() => setIbanEdit(true)} className="text-xs text-primary hover:underline font-semibold">Modifier</button>
        )}
      >
        <p className="text-gray-500 text-sm mb-3">Les reversements sont faits par virement sur ce compte.</p>
        {partner?.rib && !ibanEdit ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm text-gray-700 inline-block">
            {partner.rib.replace(/(.{4})/g, '$1 ').trim()}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <input
              value={ibanInput}
              onChange={(e) => setIbanInput(e.target.value)}
              placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX"
              className="border border-gray-200 rounded-xl px-4 py-2.5 font-mono text-sm flex-1 min-w-0"
            />
            <button type="button" onClick={saveIban} disabled={ibanSaving || !ibanInput.trim()} className="bg-primary text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50">
              {ibanSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {ibanEdit && (
              <button type="button" onClick={() => { setIbanEdit(false); setIbanInput(partner?.rib || ''); }} className="border border-gray-200 text-gray-500 font-semibold px-4 py-2.5 rounded-xl text-sm">Annuler</button>
            )}
          </div>
        )}
      </Card>
    </DashboardLayout>
  );
}
