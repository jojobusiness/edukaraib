import React, { useState } from 'react';
import { auth } from '../lib/firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import fetchWithAuth from '../utils/fetchWithAuth';

const MAX_FILE_MB = 5;

/**
 * Modal de demande de remboursement : motif obligatoire + justificatif (image/PDF).
 * La demande part en validation admin — aucun remboursement direct.
 *
 * Props :
 * - open / onClose
 * - resolvePaymentId : async () => paymentId|null (fourni par la page appelante)
 * - amountLabel : montant affiché (ex: "25,00 €")
 */
export default function RefundRequestModal({ open, onClose, resolvePaymentId, amountLabel }) {
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const reset = () => {
    setReason(''); setFile(null); setFileError(''); setSubmitting(false); setDone(false); setError('');
  };
  const close = () => { reset(); onClose?.(); };

  const onFileChange = (e) => {
    setFileError('');
    const f = e.target.files?.[0] || null;
    if (!f) { setFile(null); return; }
    const okType = /^image\/|^application\/pdf$/.test(f.type);
    if (!okType) { setFileError('Format accepté : image ou PDF.'); setFile(null); return; }
    if (f.size > MAX_FILE_MB * 1024 * 1024) { setFileError(`Fichier trop lourd (max ${MAX_FILE_MB} Mo).`); setFile(null); return; }
    setFile(f);
  };

  const submit = async () => {
    setError('');
    if (reason.trim().length < 10) { setError('Merci de détailler le motif (10 caractères minimum).'); return; }
    setSubmitting(true);
    try {
      const paymentId = await resolvePaymentId();
      if (!paymentId) throw new Error('Impossible de retrouver le paiement pour ce cours.');

      let proofUrl = null;
      if (file) {
        const uid = auth.currentUser?.uid || 'anonyme';
        const storage = getStorage();
        const path = `refund-proofs/${uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, file);
        proofUrl = await getDownloadURL(fileRef);
      }

      await fetchWithAuth('/api/refund-request', {
        method: 'POST',
        body: JSON.stringify({ paymentId, reason: reason.trim(), proofUrl }),
      });
      setDone(true);
    } catch (e) {
      if (String(e.message).includes('ALREADY_REQUESTED')) {
        setError('Une demande est déjà en cours pour ce paiement. Réponse par email sous 48 h.');
      } else if (String(e.message).includes('REASON_TOO_SHORT')) {
        setError('Merci de détailler davantage le motif.');
      } else {
        setError(e.message || 'Envoi impossible, réessayez.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">📨</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Demande envoyée</h3>
            <p className="text-sm text-gray-600 mb-4">
              Notre équipe examine votre demande. Vous recevrez une réponse par email sous 48 h.
              Si elle est acceptée, le remboursement apparaît sur votre compte sous 5 à 10 jours ouvrés.
            </p>
            <button onClick={close} className="px-5 py-2 rounded-xl bg-primary text-white font-semibold">Fermer</button>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Demande de remboursement</h3>
            {amountLabel && <p className="text-sm text-gray-500 mb-3">Montant concerné : <b>{amountLabel}</b></p>}

            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Motif de la demande <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3"
              placeholder="Expliquez ce qui s'est passé (cours non assuré, problème avec le professeur...)"
            />

            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Justificatif (image ou PDF, fortement recommandé)
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={onFileChange}
              className="w-full text-sm mb-1"
            />
            {fileError && <div className="text-xs text-red-600 mb-2">{fileError}</div>}
            <p className="text-[11px] text-gray-400 mb-3">
              Capture d'écran, échange de messages... Un justificatif accélère le traitement de votre demande.
            </p>

            {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

            <div className="flex gap-2 justify-end">
              <button onClick={close} disabled={submitting} className="px-4 py-2 rounded-xl border text-sm font-semibold hover:bg-gray-50">
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-60"
              >
                {submitting ? 'Envoi…' : 'Envoyer la demande'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
