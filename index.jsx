import React, { useState, useMemo, useEffect } from 'react';
import { 
  Users, 
  Search, 
  BarChart3, 
  ShieldCheck, 
  Plus, 
  Upload, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertTriangle,
  Database,
  ArrowRight,
  Filter,
  X
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  ScatterChart, 
  Scatter, 
  ZAxis,
  Cell
} from 'recharts';

// --- Конфигурация ---
const GOOGLE_SHEET_URL = ""; // URL вашего Google Apps Script

const SYSTEM_FIELDS = [
  { key: 'user_id', label: 'User ID', type: 'string' },
  { key: 'payment_method', label: 'Метод оплаты', type: 'string' },
  { key: 'deposit_wallet', label: 'Депозитный кошелек', type: 'string' },
  { key: 'withdrawal_wallet', label: 'Кошелек вывода', type: 'string' },
  { key: 'total_deposit', label: 'Всего депо ($)', type: 'number' },
  { key: 'total_withdrawal', label: 'Всего вывод ($)', type: 'number' },
  { key: 'currency', label: 'Валюта', type: 'string' },
  { key: 'asn', label: 'ASN', type: 'string' },
  { key: 'country', label: 'Страна', type: 'string' },
  { key: 'device', label: 'Устройство', type: 'string' },
  { key: 'created_at', label: 'Дата регистрации', type: 'date' },
];

const DEVICE_OPTIONS = ['Mobile', 'Desktop', 'Tablet'];

// --- Вспомогательные функции ---
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const deriveFields = (p) => {
  const today = new Date();
  const regDate = new Date(p.created_at || today);
  const diffTime = Math.abs(today - regDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const dep = parseFloat(p.total_deposit) || 0;
  const wit = parseFloat(p.total_withdrawal) || 0;
  
  return {
    ...p,
    days_since_registration: diffDays,
    net_balance: dep - wit,
    withdrawal_rate: dep > 0 ? wit / dep : 0
  };
};

const fuzzyMatch = (target, source) => {
  const t = target.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s = source.toLowerCase().replace(/[^a-z0-9]/g, '');
  return t.includes(s) || s.includes(t);
};

// --- Основной компонент ---
export default function App() {
  const [players, setPlayers] = useState([]);
  const [activeTab, setActiveTab] = useState('database');
  const [toast, setToast] = useState(null);
  
  // Состояния фильтрации и сортировки
  const [sortConfig, setSortConfig] = useState({ key: 'total_deposit', direction: 'desc' });
  const [filters, setFilters] = useState({ country: 'All', device: 'All' });

  // Состояние модалки импорта
  const [importModal, setImportModal] = useState({ isOpen: false, step: 1, rawText: '', parsedData: [], mapping: {} });

  // Look-alike состояние
  const [laQuery, setLaQuery] = useState({ total_deposit: 0, asn: '', country: '', device: 'Mobile', payment_method: '' });
  const [laResults, setLaResults] = useState([]);

  // Toast effect
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // --- Обработка данных ---
  const processedPlayers = useMemo(() => {
    let list = players.map(deriveFields);
    
    if (filters.country !== 'All') list = list.filter(p => p.country === filters.country);
    if (filters.device !== 'All') list = list.filter(p => p.device === filters.device);
    
    if (sortConfig.key) {
      list.sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        if (typeof valA === 'string') return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      });
    }
    return list;
  }, [players, filters, sortConfig]);

  const countries = useMemo(() => ['All', ...new Set(players.map(p => p.country).filter(Boolean))], [players]);
  const devices = useMemo(() => ['All', ...new Set(players.map(p => p.device).filter(Boolean))], [players]);

  // --- Методы ---
  const handleSort = (key) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const removeDuplicates = () => {
    const map = new Map();
    players.forEach(p => {
      const existing = map.get(p.user_id);
      if (!existing || parseFloat(p.total_deposit) > parseFloat(existing.total_deposit)) {
        map.set(p.user_id, p);
      }
    });
    setPlayers(Array.from(map.values()));
    setToast('Дубликаты по User ID удалены');
  };

  // --- Импорт ---
  const handleParse = () => {
    const delimiter = importModal.rawText.includes('\t') ? '\t' : ',';
    const lines = importModal.rawText.trim().split('\n');
    if (lines.length < 2) return;
    
    const headers = lines[0].split(delimiter).map(h => h.trim());
    const data = lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim());
      return headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || '' }), {});
    });

    // Auto mapping
    const initialMapping = {};
    SYSTEM_FIELDS.forEach(sf => {
      const found = headers.find(h => fuzzyMatch(h, sf.key) || fuzzyMatch(h, sf.label));
      if (found) initialMapping[sf.key] = found;
    });

    setImportModal(prev => ({ ...prev, step: 2, parsedData: data, mapping: initialMapping }));
  };

  const finalizeImport = async () => {
    const newItems = importModal.parsedData.map(row => {
      const item = {};
      SYSTEM_FIELDS.forEach(sf => {
        const mappedCol = importModal.mapping[sf.key];
        const val = row[mappedCol];
        item[sf.key] = sf.type === 'number' ? parseFloat(val) || 0 : val || '';
      });
      return item;
    });

    const combined = [...players, ...newItems];
    const uniqueMap = new Map();
    combined.forEach(p => {
      const existing = uniqueMap.get(p.user_id);
      if (!existing || parseFloat(p.total_deposit) > parseFloat(existing.total_deposit)) {
        uniqueMap.set(p.user_id, p);
      }
    });

    setPlayers(Array.from(uniqueMap.values()));

    if (GOOGLE_SHEET_URL) {
      try {
        await fetch(GOOGLE_SHEET_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItems)
        });
      } catch (e) { console.error("Sheets sync failed", e); }
    }

    setToast(`Импортировано ${newItems.length} записей`);
    setImportModal({ isOpen: false, step: 1, rawText: '', parsedData: [], mapping: {} });
  };

  const runLookAlike = () => {
    if (players.length === 0) return;
    const all = players.map(deriveFields);
    const maxDep = Math.max(...all.map(p => p.total_deposit), 1);
    
    const targetDep = parseFloat(laQuery.total_deposit) || 0;

    const results = all.map(p => {
      let score = 0;
      const depSim = 1 - Math.min(Math.abs((p.total_deposit / maxDep) - (targetDep / maxDep)), 1);
      score += depSim * 0.5;

      if (laQuery.country && p.country === laQuery.country) score += 0.15;
      if (laQuery.device && p.device === laQuery.device) score += 0.1;
      if (laQuery.asn && p.asn === laQuery.asn) score += 0.15;
      if (laQuery.payment_method && p.payment_method === laQuery.payment_method) score += 0.1;

      return { ...p, similarity: score };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 10);

    setLaResults(results);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans p-4 md:p-8">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 bg-purple-600 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-2 z-50 animate-bounce">
          <CheckCircle2 size={20} /> {toast}
        </div>
      )}

      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent flex items-center gap-3">
            <Database size={32} className="text-purple-500" /> Player Master 2.0
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Управление базой и Look-alike анализ</p>
        </div>
        
        <nav className="flex bg-gray-900 p-1 rounded-xl border border-gray-800">
          {[
            { id: 'database', label: 'База', icon: Users },
            { id: 'lookalike', label: 'Look-alike', icon: Search },
            { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
            { id: 'cleanup', label: 'Очистка', icon: ShieldCheck },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon size={18} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto">
        {/* DATABASE TAB */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-900 p-4 rounded-xl border border-gray-800">
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Filter size={16} className="text-purple-400" />
                  <select 
                    className="bg-gray-800 border-none rounded-md px-3 py-1 text-sm focus:ring-2 ring-purple-500"
                    value={filters.country}
                    onChange={e => setFilters(f => ({ ...f, country: e.target.value }))}
                  >
                    {countries.map(c => <option key={c} value={c}>{c === 'All' ? 'Все страны' : c}</option>)}
                  </select>
                  <select 
                    className="bg-gray-800 border-none rounded-md px-3 py-1 text-sm focus:ring-2 ring-purple-500"
                    value={filters.device}
                    onChange={e => setFilters(f => ({ ...f, device: e.target.value }))}
                  >
                    {devices.map(d => <option key={d} value={d}>{d === 'All' ? 'Все устройства' : d}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setImportModal(prev => ({ ...prev, isOpen: true }))}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                >
                  <Upload size={18} /> Вставить из таблицы
                </button>
                <button 
                  onClick={removeDuplicates}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors border border-gray-700"
                >
                  <Trash2 size={18} /> Очистить дубли
                </button>
              </div>
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
                    <tr>
                      {SYSTEM_FIELDS.map(f => (
                        <th 
                          key={f.key} 
                          onClick={() => handleSort(f.key)}
                          className="px-4 py-3 cursor-pointer hover:bg-gray-800 transition-colors whitespace-nowrap"
                        >
                          <div className="flex items-center gap-1">
                            {f.label}
                            {sortConfig.key === f.key && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                          </div>
                        </th>
                      ))}
                      <th className="px-4 py-3">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800 text-sm">
                    {processedPlayers.map((p, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/30 transition-colors group">
                        <td className="px-4 py-3 font-mono text-purple-400">{p.user_id}</td>
                        <td className="px-4 py-3">{p.payment_method}</td>
                        <td className="px-4 py-3 max-w-[120px] truncate" title={p.deposit_wallet}>{p.deposit_wallet}</td>
                        <td className="px-4 py-3 max-w-[120px] truncate">{p.withdrawal_wallet}</td>
                        <td className="px-4 py-3 font-semibold">{formatCurrency(p.total_deposit)}</td>
                        <td className="px-4 py-3 text-gray-400">{formatCurrency(p.total_withdrawal)}</td>
                        <td className="px-4 py-3">{p.currency}</td>
                        <td className="px-4 py-3 text-xs opacity-70">{p.asn}</td>
                        <td className="px-4 py-3">{p.country}</td>
                        <td className="px-4 py-3">{p.device}</td>
                        <td className="px-4 py-3">{new Date(p.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.withdrawal_rate < 0.3 ? 'bg-green-900/40 text-green-400' :
                            p.withdrawal_rate < 0.7 ? 'bg-yellow-900/40 text-yellow-400' :
                            'bg-red-900/40 text-red-400'
                          }`}>
                            {(p.withdrawal_rate * 100).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {processedPlayers.length === 0 && (
                      <tr>
                        <td colSpan="12" className="text-center py-20 text-gray-500 italic">База пуста. Импортируйте данные для начала.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* LOOK-ALIKE TAB */}
        {activeTab === 'lookalike' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 h-fit">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Search className="text-purple-500" /> Найти похожих
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Сумма депозита</label>
                  <input 
                    type="number" 
                    className="w-full bg-gray-800 border-none rounded-lg px-4 py-2 focus:ring-2 ring-purple-500 outline-none"
                    value={laQuery.total_deposit}
                    onChange={e => setLaQuery({...laQuery, total_deposit: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">ASN (Провайдер)</label>
                  <input 
                    className="w-full bg-gray-800 border-none rounded-lg px-4 py-2 focus:ring-2 ring-purple-500 outline-none"
                    placeholder="e.g. AS12345"
                    value={laQuery.asn}
                    onChange={e => setLaQuery({...laQuery, asn: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Страна</label>
                  <input 
                    className="w-full bg-gray-800 border-none rounded-lg px-4 py-2 focus:ring-2 ring-purple-500 outline-none"
                    value={laQuery.country}
                    onChange={e => setLaQuery({...laQuery, country: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Метод оплаты</label>
                  <input 
                    className="w-full bg-gray-800 border-none rounded-lg px-4 py-2 focus:ring-2 ring-purple-500 outline-none"
                    value={laQuery.payment_method}
                    onChange={e => setLaQuery({...laQuery, payment_method: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 uppercase mb-1">Устройство</label>
                  <select 
                    className="w-full bg-gray-800 border-none rounded-lg px-4 py-2 focus:ring-2 ring-purple-500 outline-none"
                    value={laQuery.device}
                    onChange={e => setLaQuery({...laQuery, device: e.target.value})}
                  >
                    {DEVICE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <button 
                  onClick={runLookAlike}
                  className="w-full bg-purple-600 hover:bg-purple-700 py-3 rounded-lg font-bold transition-all shadow-lg shadow-purple-900/20 mt-4"
                >
                  Рассчитать сходство
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-xl font-bold mb-4">Топ-10 похожих игроков</h2>
              {laResults.length > 0 ? (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-800/50 text-gray-400 text-xs">
                      <tr>
                        <th className="px-4 py-3">Score</th>
                        <th className="px-4 py-3">User ID</th>
                        <th className="px-4 py-3">Country</th>
                        <th className="px-4 py-3">Deposit</th>
                        <th className="px-4 py-3">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {laResults.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-800/30">
                          <td className="px-4 py-3 w-32">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${p.similarity > 0.6 ? 'bg-green-500' : p.similarity > 0.3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                  style={{ width: `${Math.min(p.similarity * 100, 100)}%` }}
                                ></div>
                              </div>
                              <span className="text-[10px] font-mono whitespace-nowrap">{(p.similarity * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-purple-400">{p.user_id}</td>
                          <td className="px-4 py-3 text-sm">{p.country}</td>
                          <td className="px-4 py-3 font-semibold">{formatCurrency(p.total_deposit)}</td>
                          <td className="px-4 py-3">{(p.withdrawal_rate * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-gray-900/50 border border-gray-800 border-dashed rounded-xl h-64 flex flex-col items-center justify-center text-gray-500">
                  <Search size={48} className="mb-4 opacity-20" />
                  <p>Настройте фильтры и нажмите расчет</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Всего игроков', val: players.length, color: 'from-blue-600' },
                { label: 'Avg Депозит', val: formatCurrency(players.reduce((a, b) => a + (parseFloat(b.total_deposit) || 0), 0) / (players.length || 1)), color: 'from-purple-600' },
                { label: 'Avg W/R Rate', val: ((players.map(deriveFields).reduce((a, b) => a + b.withdrawal_rate, 0) / (players.length || 1)) * 100).toFixed(1) + '%', color: 'from-pink-600' },
                { label: 'Топ Страна', val: countries[1] || 'N/A', color: 'from-orange-600' },
              ].map((kpi, i) => (
                <div key={i} className={`bg-gradient-to-br ${kpi.color} to-gray-900 p-6 rounded-xl border border-white/5 shadow-xl`}>
                  <p className="text-white/60 text-xs uppercase tracking-wider mb-1 font-bold">{kpi.label}</p>
                  <p className="text-2xl font-black">{kpi.val}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 h-[400px]">
                <h3 className="text-lg font-bold mb-6">Топ-8 стран</h3>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart data={Object.entries(players.reduce((acc, p) => ({ ...acc, [p.country]: (acc[p.country] || 0) + 1 }), {})).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
                    <XAxis dataKey="name" stroke="#718096" />
                    <YAxis stroke="#718096" />
                    <RechartsTooltip contentStyle={{ backgroundColor: '#1a202c', border: 'none', borderRadius: '8px' }} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 h-[400px]">
                <h3 className="text-lg font-bold mb-6">Связь Dep vs W/R Rate</h3>
                <ResponsiveContainer width="100%" height="85%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
                    <XAxis type="number" dataKey="total_deposit" name="Deposit" unit="$" stroke="#718096" />
                    <YAxis type="number" dataKey="withdrawal_rate" name="W/R Rate" stroke="#718096" />
                    <ZAxis type="number" range={[50, 400]} />
                    <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter name="Players" data={players.map(deriveFields)}>
                      {players.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.device === 'Mobile' ? '#8b5cf6' : entry.device === 'Desktop' ? '#ec4899' : '#3b82f6'} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* CLEANUP TAB */}
        {activeTab === 'cleanup' && (
          <div className="max-w-4xl mx-auto space-y-4">
             {[
               {
                 title: 'Дубликаты по User ID',
                 count: players.length - new Set(players.map(p => p.user_id)).size,
                 fix: removeDuplicates,
                 icon: Users
               },
               {
                 title: 'Аномальный W/R (> 100%)',
                 count: players.map(deriveFields).filter(p => p.withdrawal_rate > 1).length,
                 desc: 'Рекомендуется ручная проверка транзакций',
                 icon: AlertTriangle
               },
               {
                 title: 'Связанные кошельки (один депо на разных ID)',
                 count: players.length - new Set(players.map(p => p.deposit_wallet)).size,
                 desc: 'Возможный мультиаккаунтинг',
                 icon: Database
               },
               {
                 title: 'Нулевые депозиты',
                 count: players.filter(p => (parseFloat(p.total_deposit) || 0) === 0).length,
                 desc: 'Регистрации без финансовой активности',
                 icon: Plus
               }
             ].map((issue, idx) => (
               <div key={idx} className="bg-gray-900 p-6 rounded-xl border border-gray-800 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                   <div className={`p-3 rounded-lg ${issue.count > 0 ? 'bg-red-900/20 text-red-500' : 'bg-green-900/20 text-green-500'}`}>
                     <issue.icon size={24} />
                   </div>
                   <div>
                     <h3 className="font-bold">{issue.title}</h3>
                     <p className="text-sm text-gray-400">{issue.count > 0 ? `Проблем: ${issue.count}` : 'Все чисто'}</p>
                     {issue.desc && issue.count > 0 && <p className="text-xs text-orange-500/80 mt-1 italic">{issue.desc}</p>}
                   </div>
                 </div>
                 {issue.count > 0 && issue.fix && (
                   <button 
                    onClick={issue.fix}
                    className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm transition-colors border border-gray-700 shadow-sm"
                   >
                     Исправить
                   </button>
                 )}
                 {issue.count > 0 && !issue.fix && (
                   <span className="text-xs text-orange-400 font-medium px-3 py-1 bg-orange-400/10 rounded-full border border-orange-400/20">Проверка</span>
                 )}
                 {issue.count === 0 && <CheckCircle2 className="text-green-500" />}
               </div>
             ))}
          </div>
        )}
      </main>

      {/* MODAL: IMPORT */}
      {importModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 w-full max-w-4xl h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between bg-gray-900/50">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold">Импорт данных</h2>
                <div className="flex gap-2">
                  {[1, 2, 3].map(s => (
                    <div key={s} className={`w-8 h-1.5 rounded-full ${importModal.step >= s ? 'bg-purple-500' : 'bg-gray-700'}`} />
                  ))}
                </div>
              </div>
              <button onClick={() => setImportModal(p => ({...p, isOpen: false}))} className="text-gray-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-6 bg-gray-950/30" style={{ minHeight: 0 }}>
              {importModal.step === 1 && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <p className="text-gray-400">Вставьте данные из Excel или CSV. Первая строка должна быть заголовком.</p>
                  <textarea 
                    autoFocus
                    className="w-full h-80 bg-gray-900 border border-gray-800 rounded-xl p-4 font-mono text-sm focus:ring-2 ring-purple-500 outline-none resize-none shadow-inner"
                    placeholder="User ID, Payment, Wallet, Deposit...&#10;1001, Visa, 0x123, 500..."
                    value={importModal.rawText}
                    onChange={e => setImportModal(prev => ({ ...prev, rawText: e.target.value }))}
                  />
                </div>
              )}

              {importModal.step === 2 && (
                <div className="animate-in slide-in-from-right duration-300">
                  <h3 className="font-bold mb-4 text-purple-400 flex items-center gap-2">
                    <Database size={18}/> Сопоставление полей
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    {SYSTEM_FIELDS.map(sf => (
                      <div key={sf.key} className="flex flex-col gap-1 p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
                        <label className="text-xs text-gray-400 font-semibold">{sf.label}</label>
                        <select 
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:ring-2 ring-purple-500 outline-none"
                          value={importModal.mapping[sf.key] || ''}
                          onChange={e => setImportModal(prev => ({ 
                            ...prev, 
                            mapping: { ...prev.mapping, [sf.key]: e.target.value } 
                          }))}
                        >
                          <option value="">-- Пропустить --</option>
                          {Object.keys(importModal.parsedData[0] || {}).map(header => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importModal.step === 3 && (
                <div className="animate-in slide-in-from-right duration-300">
                  <h3 className="font-bold mb-4 text-purple-400">Предпросмотр данных</h3>
                  <div className="overflow-x-auto border border-gray-800 rounded-lg shadow-sm">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-gray-800/80">
                        <tr>
                          {SYSTEM_FIELDS.map(sf => <th key={sf.key} className="p-3 whitespace-nowrap">{sf.label}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800 bg-gray-900/40">
                        {importModal.parsedData.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            {SYSTEM_FIELDS.map(sf => (
                              <td key={sf.key} className="p-3 max-w-[150px] truncate">
                                {row[importModal.mapping[sf.key]] || '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                    <p className="text-sm">
                      Готово к импорту записей: <span className="text-purple-400 font-black">{importModal.parsedData.length}</span>. 
                      После импорта будет произведена автоматическая дедупликация.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-800 flex justify-between items-center sticky bottom-0 bg-gray-900 z-10 shadow-lg">
              {importModal.step > 1 ? (
                <button 
                  onClick={() => setImportModal(p => ({ ...p, step: p.step - 1 }))}
                  className="px-6 py-2 text-gray-400 hover:text-white transition-colors flex items-center gap-1 font-medium"
                >
                  Назад
                </button>
              ) : <div />}
              
              <div className="flex gap-2">
                {importModal.step < 3 ? (
                  <button 
                    disabled={!importModal.rawText}
                    onClick={handleParse}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-8 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-purple-900/30"
                  >
                    Далее <ArrowRight size={18} />
                  </button>
                ) : (
                  <button 
                    onClick={finalizeImport}
                    className="bg-green-600 hover:bg-green-700 text-white px-8 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-green-900/30"
                  >
                    Импортировать в базу
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}