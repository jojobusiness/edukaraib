import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { collection, doc, getDocs, getDoc, orderBy, query } from 'firebase/firestore';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';

export default function AnalyticsTab() {
  const [daily, setDaily]   = useState([]);
  const [top, setTop]       = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const dailySnap = await getDocs(
          query(collection(db, 'analytics_daily'), orderBy('__name__', 'desc'))
        );
        const dailyData = dailySnap.docs
          .map(d => ({ date: d.id, pageviews: d.data().pageviews || 0, visitors: d.data().visitors || 0 }))
          .slice(0, 30)
          .reverse();
        setDaily(dailyData);

        const [pages, countries, devices, browsers, referrers] = await Promise.all([
          getDoc(doc(db, 'analytics_top', 'pages')),
          getDoc(doc(db, 'analytics_top', 'countries')),
          getDoc(doc(db, 'analytics_top', 'devices')),
          getDoc(doc(db, 'analytics_top', 'browsers')),
          getDoc(doc(db, 'analytics_top', 'referrers')),
        ]);
        setTop({
          pages:     pages.exists()     ? pages.data()     : {},
          countries: countries.exists() ? countries.data() : {},
          devices:   devices.exists()   ? devices.data()   : {},
          browsers:  browsers.exists()  ? browsers.data()  : {},
          referrers: referrers.exists() ? referrers.data() : {},
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const totalPageviews = daily.reduce((s, d) => s + d.pageviews, 0);
  const totalVisitors  = daily.reduce((s, d) => s + d.visitors,  0);

  const topList = (obj, decodeSlash = false) =>
    Object.entries(obj || {})
      .map(([k, v]) => ({
        key: decodeSlash
          ? k.replace(/__SLASH__/g, '/').replace(/__DOT__/g, '.')
          : k,
        count: Number(v),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

  if (loading) {
    return <div className="text-center py-16 text-gray-400">Chargement des données analytics…</div>;
  }

  const hasData = daily.length > 0 || Object.keys(top.pages || {}).length > 0;

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Pages vues (30j)"  value={totalPageviews.toLocaleString('fr-FR')} color="text-primary" />
        <KpiCard label="Visiteurs (30j)"   value={totalVisitors.toLocaleString('fr-FR')}  color="text-yellow-500" />
        <KpiCard label="Jours avec data"   value={daily.length}                            color="text-gray-700" />
        <KpiCard label="Pages distinctes"  value={topList(top.pages).length}               color="text-gray-700" />
      </div>

      {!hasData && (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400">
          Aucune donnée pour l'instant — les premières visites apparaîtront ici dans quelques minutes.
        </div>
      )}

      {/* Courbe tendance */}
      {daily.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-4">Tendance — 30 derniers jours</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={daily} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00804B" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#00804B" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#FFC107" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#FFC107" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={d => `📅 ${d}`}
                formatter={(v, n) => [v.toLocaleString('fr-FR'), n === 'pageviews' ? 'Pages vues' : 'Visiteurs']}
              />
              <Area type="monotone" dataKey="pageviews" stroke="#00804B" fill="url(#gv)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="visitors"  stroke="#FFC107"  fill="url(#gu)"  strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-gray-500 justify-end">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary inline-block rounded" /> Pages vues</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-yellow-400 inline-block rounded" /> Visiteurs</span>
          </div>
        </div>
      )}

      {/* Tables top */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopTable title="Top pages"             rows={topList(top.pages, true)} />
        <TopTable title="Pays"                  rows={topList(top.countries)} />
        <TopTable title="Appareils"             rows={topList(top.devices)} />
        <TopTable title="Navigateurs"           rows={topList(top.browsers)} />
      </div>
      <TopTable title="Sources de trafic (referrers)" rows={topList(top.referrers)} wide />
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TopTable({ title, rows, wide }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${wide ? 'md:col-span-2' : ''}`}>
      <h4 className="font-semibold text-gray-700 mb-3">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Pas encore de données</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ key, count }) => {
            const pct = Math.round((count / rows[0].count) * 100);
            return (
              <li key={key} className="text-sm">
                <div className="flex justify-between mb-1">
                  <span className="truncate text-gray-700 max-w-[80%]">{key}</span>
                  <span className="font-semibold text-gray-900">{count.toLocaleString('fr-FR')}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
