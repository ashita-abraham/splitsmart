export interface Member {
  id: number;
  name: string;
}

export interface ExpenseSplit {
  member_id: number;
  member_name: string;
  share_cents: number;
}

export interface Expense {
  id: number;
  description: string;
  amount_cents: number;
  paid_by_member_id: number;
  paid_by_name: string;
  split_type: 'equal' | 'exact';
  created_at: string;
  splits: ExpenseSplit[];
}

export interface MemberBalance {
  member_id: number;
  name: string;
  total_paid_cents: number;
  total_share_cents: number;
  net_balance_cents: number;
}

export interface Settlement {
  from_member_id: number;
  from_name: string;
  to_member_id: number;
  to_name: string;
  amount_cents: number;
}

export interface GroupSummary {
  id: number;
  name: string;
  total_spend_cents: number;
  members: Member[];
  expenses: Expense[];
  balances: MemberBalance[];
  settlements: Settlement[];
}

export interface GroupListItem {
  id: number;
  name: string;
  created_at: string;
}