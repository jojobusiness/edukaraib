import React, { useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import DashboardLayout from '../components/DashboardLayout';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function TeacherEarnings() {
  const [total, setTotal] = useState(0);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    const fetch = async () => {
      const q = query(collection(db, 'lessons'), where('teacher_id', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => doc.data());

      const paidCourses = data.filter(c => c.is_paid && c.start_datetime);
      // Données par mois (janv-déc)
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: new Date(0, i).toLocaleString('fr-FR', { month: 'short' }),
        gains: 0,
        net: 0
      }));
      let totalGross = 0;

      paidCourses.forEach(c => {
        const date = new Date(c.start_datetime.seconds * 1000);
        const monthIdx = date.getMonth();
        const prix = parseFloat(c.price_per_hour || 0);
        months[monthIdx].gains += prix;
        months[monthIdx].net += prix * 0.9;
        totalGross += prix;
      });
      setTotal(totalGross * 0.9); // Total net sur l'année (après 10%)
      setChartData(months);
    };
    fetch();
  }, []);

  return (
    <DashboardLayout role="teacher">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-primary mb-4">💰 Mes revenus</h2>
        <div className="bg-white rounded-xl shadow p-6 mb-8 border">
          <p className="text-lg mb-2">
            <span className="font-semibold text-primary">Total net (après commission) :</span>
            <span className="ml-2 text-2xl font-bold">{total.toFixed(2)} €</span>
          </p>
          <p className="text-sm text-gray-500 mb-2">
            <span className="text-yellow-600 font-semibold">Commission plateforme :</span> 10% déduits à chaque paiement reçu.
          </p>
        </div>
        <div className="bg-white rounded-xl shadow p-6 border">
          <h3 className="font-bold text-primary mb-3">Évolution sur l'année</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={v => v.toFixed(2) + " €"} />
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