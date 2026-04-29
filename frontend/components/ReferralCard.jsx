import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const BASE_URL = 'https://edukaraib.com';
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  let s = 'REF-';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

export default function ReferralCard() {
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid)).then(async snap => {
      if (cancelled || !snap.exists()) return;
      let existing = snap.data()?.studentReferralCode;
      if (!existing) {
        existing = genCode();
        await setDoc(doc(db, 'users', user.uid), { studentReferralCode: existing }, { merge: true });
      }
      if (!cancelled) setCode(existing);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!code) return null;

  const link = `${BASE_URL}/register?ref=${code}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div className="bg-gradient-to-br from-yellow-50 to-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">🤝</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-amber-900 mb-1">Parrainez un ami — vous gagnez tous les deux -10 €</h4>
          <p className="text-sm text-amber-800 mb-3 leading-relaxed">
            Partagez votre lien unique. Quand votre filleul effectue son premier paiement,
            vous recevez chacun un bon de réduction de <strong>10 €</strong> sur votre prochain cours.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-xs font-mono text-amber-900 truncate max-w-[220px]">
              {link}
            </code>
            <button
              onClick={handleCopy}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                copied
                  ? 'bg-green-100 text-green-700 border border-green-300'
                  : 'bg-amber-400 hover:bg-amber-500 text-amber-900 border border-amber-400'
              }`}
            >
              {copied ? '✓ Copié !' : 'Copier le lien'}
            </button>
          </div>
          <p className="text-xs text-amber-700 mt-2">Votre code : <strong>{code}</strong></p>
        </div>
      </div>
    </div>
  );
}
