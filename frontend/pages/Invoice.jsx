import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtAmount = (n) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const invoiceNumber = (id, createdAt) => {
  const d = createdAt?.toDate ? createdAt.toDate() : new Date(createdAt || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `FAC-${y}${m}${day}-${String(id || '').slice(-6).toUpperCase()}`;
};

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Invoice() {
  const { paymentId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const user = auth.currentUser;
        if (!user) { window.location.href = '/login'; return; }

        const paySnap = await getDoc(doc(db, 'payments', paymentId));
        if (!paySnap.exists()) { setError('Facture introuvable.'); return; }
        const pay = { id: paySnap.id, ...paySnap.data() };

        const [lessonSnap, teacherSnap, payerSnap] = await Promise.all([
          pay.lesson_id ? getDoc(doc(db, 'lessons', String(pay.lesson_id))) : Promise.resolve(null),
          pay.teacher_uid ? getDoc(doc(db, 'users', String(pay.teacher_uid))) : Promise.resolve(null),
          getDoc(doc(db, 'users', user.uid)),
        ]);

        const lesson = lessonSnap?.exists() ? { id: lessonSnap.id, ...lessonSnap.data() } : null;
        const teacher = teacherSnap?.exists() ? teacherSnap.data() : null;
        const payer = payerSnap?.exists() ? payerSnap.data() : null;

        setData({ pay, lesson, teacher, payer, user });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [paymentId]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>
      Chargement de la facture…
    </div>
  );
  if (error) return (
    <div style={{ textAlign: 'center', padding: '80px', color: '#e53e3e', fontFamily: 'Inter, sans-serif' }}>
      {error}
    </div>
  );
  if (!data) return null;

  const { pay, lesson, teacher, payer, user } = data;

  const teacherName = teacher
    ? ([teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || teacher.displayName || 'Professeur')
    : 'Professeur';

  const payerName = payer
    ? ([payer.firstName, payer.lastName].filter(Boolean).join(' ') || payer.displayName || user.email)
    : user.email;

  const payerEmail = payer?.email || user.email || '';

  const isPack = !!pay.is_pack;
  const billedHours = Number(pay.billed_hours || 1);
  const source = String(pay.lesson_source || '');
  const modeLabel = source.includes('visio') ? 'Visio' : 'Présentiel';
  const typeLabel = isPack
    ? `Pack ${billedHours}h · ${modeLabel}`
    : `${modeLabel} · ${billedHours}h`;

  const subjectLabel = lesson?.subject_id ? `Cours de ${lesson.subject_id}` : 'Cours particulier';
  const lessonDateStr = fmtDate(
    lesson?.scheduled_at || lesson?.date || lesson?.start_datetime || null
  );

  const total = Number(pay.gross_eur || 0);
  const invNum = invoiceNumber(pay.id, pay.created_at);
  const invDate = fmtDate(pay.created_at || new Date());

  return (
    <>
      <style>{`
        @page { margin: 1.5cm; }
        @media print {
          .no-print { display: none !important; }
          .no-print-margin { margin: 0 !important; padding: 0 !important; background: white !important; }
          .invoice-card { box-shadow: none !important; border-radius: 0 !important; border: none !important; }
          .invoice-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        * { box-sizing: border-box; }
        body { font-family: Inter, system-ui, Arial, sans-serif; background: #f1f5f9; margin: 0; }
      `}</style>

      <div className="no-print-margin" style={{ background: '#f1f5f9', minHeight: '100vh', paddingBottom: 40 }}>
        {/* Bouton imprimer */}
        <div className="no-print" style={{ textAlign: 'center', padding: '24px 0 12px' }}>
          <button
            onClick={() => window.print()}
            style={{
              background: '#00804B', color: 'white', border: 'none', borderRadius: 10,
              padding: '11px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            🖨️ Imprimer / Télécharger PDF
          </button>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            Dans la boîte de dialogue, choisissez « Enregistrer en PDF » comme destination.
          </p>
        </div>

        {/* Carte facture */}
        <div
          className="invoice-card"
          style={{ maxWidth: 760, margin: '0 auto', background: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,.1)' }}
        >
          {/* Header vert */}
          <div
            className="invoice-header"
            style={{ background: '#00804B', padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src="/edukaraib_logo.png"
                alt="EduKaraib"
                style={{ width: 44, height: 44, borderRadius: 8, background: 'white', padding: 2 }}
                onError={e => { e.target.style.display = 'none'; }}
              />
              <span style={{ color: 'white', fontWeight: 800, fontSize: 20 }}>EduKaraib</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#bbf7d0', fontWeight: 700, fontSize: 26, letterSpacing: 3 }}>FACTURE</div>
              <div style={{ color: 'white', fontWeight: 600, fontSize: 14, marginTop: 4 }}>{invNum}</div>
            </div>
          </div>

          {/* Corps */}
          <div style={{ padding: '28px 32px' }}>

            {/* Infos prestataire + date */}
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
              <div>
                <div style={labelStyle}>Prestataire</div>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>EduKaraib</div>
                <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                  Plateforme de soutien scolaire en ligne<br />
                  edukaraib.com · contact@edukaraib.com
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={labelStyle}>Date d'émission</div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{invDate}</div>
                <div style={{ marginTop: 10 }}>
                  <div style={labelStyle}>Statut</div>
                  <div style={{ color: '#16a34a', fontWeight: 700 }}>✅ Payée</div>
                </div>
              </div>
            </div>

            {/* Client */}
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', marginBottom: 24, border: '1px solid #e2e8f0' }}>
              <div style={labelStyle}>Facturée à</div>
              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 15 }}>{payerName}</div>
              {payerEmail && <div style={{ fontSize: 13, color: '#475569' }}>{payerEmail}</div>}
            </div>

            {/* Tableau de services */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Description', 'Professeur', 'Date du cours', 'Montant'].map((h, i) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: i === 3 ? 'right' : 'left',
                      fontSize: 12, fontWeight: 600, color: '#64748b',
                      borderBottom: '2px solid #e2e8f0', borderTop: '1px solid #e2e8f0',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{subjectLabel}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{typeLabel}</div>
                  </td>
                  <td style={tdStyle}>{teacherName}</td>
                  <td style={tdStyle}>{lessonDateStr}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{fmtAmount(total)}</td>
                </tr>
              </tbody>
            </table>

            {/* Totaux */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: 300 }}>
                <Row label="Sous-total HT" value={fmtAmount(total)} />
                <Row label="TVA" value={<span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non applicable¹</span>} />
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 16, fontWeight: 800, borderTop: '2px solid #e2e8f0' }}>
                  <span style={{ color: '#0f172a' }}>Total TTC</span>
                  <span style={{ color: '#00804B' }}>{fmtAmount(total)}</span>
                </div>
              </div>
            </div>

            {/* Note légale + crédit d'impôt */}
            <div style={{ marginTop: 24, padding: '14px 18px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', fontSize: 13, color: '#92400e', lineHeight: 1.65 }}>
              <div>
                <strong>¹ TVA non applicable</strong>, art. 293B du CGI.
              </div>
              <div style={{ marginTop: 8 }}>
                <strong>💡 Crédit d'impôt :</strong> En France, les cours particuliers à domicile ou en ligne ouvrent droit à un{' '}
                <strong>crédit d'impôt de 50 %</strong> des sommes versées (service à la personne — art. 199 sexdecies CGI).
                Conservez cette facture comme justificatif fiscal.
              </div>
            </div>

            {/* Pied de page */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
              EduKaraib ·{' '}
              <a href="https://edukaraib.com" style={{ color: '#00804B', textDecoration: 'none' }}>edukaraib.com</a>
              {' · '}
              <a href="mailto:contact@edukaraib.com" style={{ color: '#00804B', textDecoration: 'none' }}>contact@edukaraib.com</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Micro-composants ──────────────────────────────────────────────────────────
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4,
};

const tdStyle = {
  padding: '12px 14px', fontSize: 14, color: '#475569',
  borderBottom: '1px solid #f1f5f9',
};

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14, color: '#475569' }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
