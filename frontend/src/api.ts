import type { GroupListItem, GroupSummary } from './types';

const API_BASE = 'http://127.0.0.1:8001/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  listGroups: () =>
    fetch(`${API_BASE}/groups`).then((r) => handleResponse<GroupListItem[]>(r)),

  createGroup: (name: string) =>
    fetch(`${API_BASE}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => handleResponse<GroupSummary>(r)),

  createDemoGroup: () =>
    fetch(`${API_BASE}/groups/demo`, { method: 'POST' }).then((r) =>
      handleResponse<GroupSummary>(r)
    ),

  getGroup: (groupId: number) =>
    fetch(`${API_BASE}/groups/${groupId}`).then((r) =>
      handleResponse<GroupSummary>(r)
    ),

  deleteGroup: (groupId: number) =>
    fetch(`${API_BASE}/groups/${groupId}`, { method: 'DELETE' }).then((r) =>
      handleResponse<{ deleted: boolean }>(r)
    ),

  addMember: (groupId: number, name: string) =>
    fetch(`${API_BASE}/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => handleResponse<GroupSummary>(r)),

  addExpense: (
    groupId: number,
    payload: {
      description: string;
      amount_cents: number;
      paid_by_member_id: number;
      split_type: 'equal' | 'exact';
      split_member_ids?: number[];
      exact_splits?: Record<number, number>;
    }
  ) =>
    fetch(`${API_BASE}/groups/${groupId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<GroupSummary>(r)),

  deleteExpense: (groupId: number, expenseId: number) =>
    fetch(`${API_BASE}/groups/${groupId}/expenses/${expenseId}`, {
      method: 'DELETE',
    }).then((r) => handleResponse<GroupSummary>(r)),
};