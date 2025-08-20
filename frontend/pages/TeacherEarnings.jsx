import React, { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function TeacherEarnings() {
  const [total, setTotal] = useState(0);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return; // on attend la connexion

      setLoading(true);

      // 1) Récupérer toutes les leçons du prof
      const qLessons = query(collection(db, 'lessons'), where('teacher_id', '==', uid));
      const snap = await getDocs(qLessons);
      const lessons = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 2) Garder seulement les paiements réalisés
      const year = new Date().getFullYear();
      const paidCourses = lessons.filter(l => {
        if (!l.is_paid) return false;
        const d = l.paid_at?.toDate?.() || l.created_at?.toDate?.();
        return d ? d.getFullYear() === year : true;
      });

      // 3) Fonction pour trouver la "date de revenu" (paid_at > created_at > maintenant)
      const getRevenueDate = (l) => {
        // Firestore Timestamp -> JS Date
        if (l.paid_at?.toDate) return l.paid_at.toDate();
        if (l.created_at?.toDate) return l.created_at.toDate();
        // dernier recours: dériver depuis la semaine courante n’a pas de sens pour un revenu passé,
        // donc on se rabat sur "aujourd’hui" pour ne PAS perdre le revenu (rare)
        return new Date();
      };

      // 4) Tableau des 12 mois courants (janv → déc)
      const months = Array.from({ length: 12 }, (_, i) => ({
        idx: i,
        month: new Date(0, i).toLocaleString('fr-FR', { month: 'short' }),
        gains: 0,
        net: 0
      }));

      // 5) Remplir les montants
      let totalGross = 0;
      paidCourses.forEach(l => {
        const date = getRevenueDate(l);
        const mIdx = date.getMonth();
        const prix = Number(l.price_per_hour || 0) || 0;
        months[mIdx].gains += prix;
        months[mIdx].net += prix * 0.90; // 10% commission
        totalGross += prix;
      });

      setTotal(totalGross * 0.90);
      setChartData(months);
      setLoading(false);
    };

    run();
  }, [auth.currentUser?.uid]); // relance si (dé)connexion

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-4">💰 Mes revenus</h2>

        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          {loading ? (
            <p className="text-gray-500">Calcul en cours…</p>
          ) : (
            <>
              <p className="text-lg mb-2">
                <span className="font-semibold text-primary">Total net (après commission)&nbsp;:</span>
                <span className="ml-2 text-2xl font-bold">{total.toFixed(2)} €</span>
              </p>
              <p className="text-sm text-gray-500 mb-2">
                <span className="text-yellow-600 font-semibold">Commission plateforme&nbsp;:</span> 10% déduits à chaque paiement reçu.
              </p>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6 border">
          <h3 className="font-bold text-primary mb-3">Évolution sur l'année</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => `${Number(v).toFixed(2)} €`} />
              <Legend />
              <Bar dataKey="gains" fill="#FFC107" name="Brut" />
              <Bar dataKey="net" fill="#00804B" name="Net (90%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </DashboardLayout>
  );
}