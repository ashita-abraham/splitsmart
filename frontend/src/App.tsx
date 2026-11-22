import React, { useEffect, useState } from 'react';
import { api } from './api';
import type { GroupListItem, GroupSummary } from './types';

function formatMoney(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  return cents < 0 ? `-${formatted}` : formatted;
}

export default function App() {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupSummary | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Expense form state
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [paidById, setPaidById] = useState<number | ''>('');
  const [splitType, setSplitType] = useState<'equal' | 'exact'>('equal');
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [exactAmounts, setExactAmounts] = useState<Record<number, string>>({});

  const refreshGroups = async (selectId?: number) => {
    const list = await api.listGroups();
    setGroups(list);
    const targetId = selectId ?? activeGroup?.id ?? list[0]?.id;
    if (targetId) {
      const summary = await api.getGroup(targetId);
      syncGroupState(summary);
    } else {
      setActiveGroup(null);
    }
  };

  const syncGroupState = (summary: GroupSummary) => {
    setActiveGroup(summary);
    const memberIds = summary.members.map((m) => m.id);
    setSelectedMemberIds(memberIds);
    if (summary.members.length > 0 && !memberIds.includes(Number(paidById))) {
      setPaidById(summary.members[0].id);
    }
    const nextExact: Record<number, string> = {};
    summary.members.forEach((m) => {
      nextExact[m.id] = '';
    });
    setExactAmounts(nextExact);
  };

  useEffect(() => {
    refreshGroups().catch((e) => setError(e.message));
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const created = await api.createGroup(newGroupName.trim());
      setNewGroupName('');
      await refreshGroups(created.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeedDemo = async () => {
    setError(null);
    setLoading(true);
    try {
      const demo = await api.createDemoGroup();
      await refreshGroups(demo.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !newMemberName.trim()) return;
    setError(null);
    try {
      const updated = await api.addMember(activeGroup.id, newMemberName.trim());
      setNewMemberName('');
      syncGroupState(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleSplitMember = (id: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    setError(null);

    const parsedDollars = parseFloat(amountStr);
    if (isNaN(parsedDollars) || parsedDollars <= 0) {
      setError('Enter a valid expense amount greater than $0.00.');
      return;
    }
    const amountCents = Math.round(parsedDollars * 100);

    if (!paidById) {
      setError('Select who paid for this expense.');
      return;
    }

    try {
      let updated: GroupSummary;
      if (splitType === 'equal') {
        updated = await api.addExpense(activeGroup.id, {
          description: description.trim(),
          amount_cents: amountCents,
          paid_by_member_id: Number(paidById),
          split_type: 'equal',
          split_member_ids: selectedMemberIds,
        });
      } else {
        const exactMap: Record<number, number> = {};
        for (const m of activeGroup.members) {
          const val = parseFloat(exactAmounts[m.id] || '0');
          if (isNaN(val) || val < 0) {
            setError(`Invalid split amount for ${m.name}.`);
            return;
          }
          exactMap[m.id] = Math.round(val * 100);
        }
        updated = await api.addExpense(activeGroup.id, {
          description: description.trim(),
          amount_cents: amountCents,
          paid_by_member_id: Number(paidById),
          split_type: 'exact',
          exact_splits: exactMap,
        });
      }

      setDescription('');
      setAmountStr('');
      syncGroupState(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteExpense = async (expenseId: number) => {
    if (!activeGroup) return;
    setError(null);
    try {
      const updated = await api.deleteExpense(activeGroup.id, expenseId);
      syncGroupState(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteGroup = async () => {
    if (!activeGroup) return;
    setError(null);
    try {
      await api.deleteGroup(activeGroup.id);
      setActiveGroup(null);
      await refreshGroups();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const exactAllocatedCents = activeGroup
    ? activeGroup.members.reduce((sum, m) => {
        const v = parseFloat(exactAmounts[m.id] || '0');
        return sum + (isNaN(v) ? 0 : Math.round(v * 100));
      }, 0)
    : 0;
  const totalTargetCents = Math.round((parseFloat(amountStr) || 0) * 100);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 font-bold text-lg">
              $
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                SplitSmart
              </h1>
              <p className="text-xs text-slate-400">
                Zero-friction group expense ledger & minimum-transfer settlement
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {groups.length > 0 && (
              <select
                value={activeGroup?.id ?? ''}
                onChange={(e) => refreshGroups(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-400"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}

            <form onSubmit={handleCreateGroup} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="New group name..."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-indigo-400 w-44"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition cursor-pointer"
              >
                + Group
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 bg-rose-950/70 border border-rose-500/50 text-rose-200 px-4 py-3 rounded-xl flex items-center justify-between text-sm">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-rose-300 hover:text-white font-semibold ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {!activeGroup ? (
          <div className="text-center py-20 px-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
            <h2 className="text-xl font-semibold text-white mb-2">
              Create a Group to Get Started
            </h2>
            <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
              Start a fresh ledger for a trip, dinner, or apartment—add your friends,
              log who paid for what, and see the simplest way to settle up.
            </p>
            <form
              onSubmit={handleCreateGroup}
              className="flex items-center justify-center gap-2 max-w-sm mx-auto mb-5"
            >
              <input
                type="text"
                placeholder="e.g., Omaha Road Trip"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition cursor-pointer"
              >
                Create
              </button>
            </form>
            <button
              type="button"
              onClick={handleSeedDemo}
              className="text-xs text-slate-400 hover:text-indigo-300 underline underline-offset-4 transition cursor-pointer"
            >
              Or populate a sample 4-person trip
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Top Group Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">
                    {activeGroup.name}
                  </h2>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {activeGroup.members.length} members
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Total Group Spend:{' '}
                  <span className="text-white font-semibold">
                    {formatMoney(activeGroup.total_spend_cents)}
                  </span>
                </p>
              </div>

              <button
                onClick={handleDeleteGroup}
                className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 hover:border-rose-500/60 px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                Delete Group
              </button>
            </div>

            {/* Simplest Way to Settle Up + Net Balances */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Settlements Card */}
              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-white">
                    Simplest Way to Settle Up
                  </h3>
                  <span className="text-xs text-indigo-300 bg-indigo-500/15 border border-indigo-400/30 px-2.5 py-0.5 rounded-full">
                    {activeGroup.settlements.length}{' '}
                    {activeGroup.settlements.length === 1 ? 'transfer' : 'transfers'}
                  </span>
                </div>

                {activeGroup.settlements.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-xl">
                    Everyone is completely settled up!
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {activeGroup.settlements.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3.5"
                      >
                        <div className="flex items-center gap-2.5 text-sm">
                          <span className="font-semibold text-rose-300">
                            {s.from_name}
                          </span>
                          <span className="text-slate-500">pays</span>
                          <span className="font-semibold text-emerald-300">
                            {s.to_name}
                          </span>
                        </div>
                        <span className="font-mono font-bold text-base text-white bg-slate-800 px-3 py-1 rounded-lg">
                          {formatMoney(s.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Individual Balances Card */}
              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-base font-semibold text-white mb-4">
                  Member Balances
                </h3>

                {activeGroup.balances.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Add people below to track balances.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activeGroup.balances.map((b) => {
                      const isPositive = b.net_balance_cents > 0;
                      const isNegative = b.net_balance_cents < 0;
                      return (
                        <div
                          key={b.member_id}
                          className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3"
                        >
                          <div>
                            <p className="font-medium text-sm text-white">
                              {b.name}
                            </p>
                            <p className="text-xs text-slate-400">
                              Paid {formatMoney(b.total_paid_cents)} · Share{' '}
                              {formatMoney(b.total_share_cents)}
                            </p>
                          </div>
                          <div className="text-right">
                            <span
                              className={`font-mono font-semibold text-sm px-2.5 py-1 rounded-lg ${
                                isPositive
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : isNegative
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {isPositive
                                ? `gets back ${formatMoney(b.net_balance_cents)}`
                                : isNegative
                                ? `owes ${formatMoney(Math.abs(b.net_balance_cents))}`
                                : 'settled ($0.00)'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Bottom Grid: People + Add Expense + Expense History */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Add People & Log Expense */}
              <div className="lg:col-span-5 space-y-6">
                {/* Add Person */}
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-base font-semibold text-white mb-3">
                    1. People in Group
                  </h3>
                  <form onSubmit={handleAddMember} className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Add friend's name..."
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                    />
                    <button
                      type="submit"
                      className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-xl border border-slate-700 transition cursor-pointer"
                    >
                      Add
                    </button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {activeGroup.members.map((m) => (
                      <span
                        key={m.id}
                        className="text-xs bg-slate-800/90 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-full"
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                </section>

                {/* Add Expense */}
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-base font-semibold text-white mb-4">
                    2. Log an Expense
                  </h3>
                  <form onSubmit={handleAddExpense} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        What was it for?
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g., Dinner, Airbnb, Gas"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">
                          Amount ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          placeholder="0.00"
                          value={amountStr}
                          onChange={(e) => setAmountStr(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">
                          Paid by
                        </label>
                        <select
                          value={paidById}
                          onChange={(e) => setPaidById(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-400"
                        >
                          {activeGroup.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Split Mode Switcher */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-slate-400">
                          Split between
                        </label>
                        <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs">
                          <button
                            type="button"
                            onClick={() => setSplitType('equal')}
                            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                              splitType === 'equal'
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Equal
                          </button>
                          <button
                            type="button"
                            onClick={() => setSplitType('exact')}
                            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                              splitType === 'exact'
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            Exact $
                          </button>
                        </div>
                      </div>

                      {splitType === 'equal' ? (
                        <div className="flex flex-wrap gap-2">
                          {activeGroup.members.map((m) => {
                            const checked = selectedMemberIds.includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => toggleSplitMember(m.id)}
                                className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${
                                  checked
                                    ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                                    : 'bg-slate-950 border-slate-800 text-slate-500'
                                }`}
                              >
                                {checked ? '✓ ' : ''}
                                {m.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                          {activeGroup.members.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-slate-300">{m.name}</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={exactAmounts[m.id] || ''}
                                onChange={(e) =>
                                  setExactAmounts((prev) => ({
                                    ...prev,
                                    [m.id]: e.target.value,
                                  }))
                                }
                                className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-right text-white"
                              />
                            </div>
                          ))}
                          <div className="pt-2 border-t border-slate-800 flex justify-between text-xs">
                            <span className="text-slate-400">Allocated:</span>
                            <span
                              className={
                                exactAllocatedCents === totalTargetCents &&
                                totalTargetCents > 0
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-amber-300 font-semibold'
                              }
                            >
                              {formatMoney(exactAllocatedCents)} /{' '}
                              {formatMoney(totalTargetCents)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={activeGroup.members.length === 0}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl text-sm transition cursor-pointer"
                    >
                      Add Expense
                    </button>
                  </form>
                </section>
              </div>

              {/* Right Column: Expense Ledger */}
              <section className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-base font-semibold text-white mb-4">
                  Expense History ({activeGroup.expenses.length})
                </h3>

                {activeGroup.expenses.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-xl">
                    No expenses logged yet. Add one on the left!
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeGroup.expenses.map((exp) => (
                      <div
                        key={exp.id}
                        className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex items-start justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-white text-sm">
                              {exp.description}
                            </h4>
                            <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                              {exp.split_type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            Paid by{' '}
                            <span className="text-slate-200 font-medium">
                              {exp.paid_by_name}
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {exp.splits.map((sp) => (
                              <span
                                key={sp.member_id}
                                className="text-[11px] bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded-md"
                              >
                                {sp.member_name}: {formatMoney(sp.share_cents)}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <span className="font-mono font-bold text-white text-base">
                            {formatMoney(exp.amount_cents)}
                          </span>
                          <button
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="text-xs text-slate-500 hover:text-rose-400 transition cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}