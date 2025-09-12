import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fmtEUR } from '../../utils/earnings';

export default function EarningsChart({ chartData /*, commissionRate (ignoré) */ }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis tickFormatter={(v) => `${v}`} />
        <Tooltip formatter={(v, name) => [fmtEUR(v), name]} />
        <Legend />
        <Bar dataKey="gains" name="Brut" fill="#F59E0B" />
        <Bar dataKey="net" name="Net (−10 € / cours)" fill="#10B981" />
      </BarChart>
    </ResponsiveContainer>
  );
}