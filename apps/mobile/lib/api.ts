import { supabase } from "./supabase";

export type Bootstrap = {
  me: {
    id: string;
    username: string;
    roles: string[];
    sound_pref: string;
    household_id: string;
  };
  viewAs: string | null;
  settings: {
    daily_target: number;
    penalty_pts: number;
  } | null;
  householdMembers: { id: string; username: string; roles: string[] }[];
  chores: any[];
  rewards: any[];
  oneTimeTasks: any[];
  progress: {
    points: number;
    checked: Record<string, boolean>;
    last_reset_date: string | null;
  } | null;
  historyDays: any[];
  adminLog: any[];
  manageChores?: any[];
  manageRewards?: any[];
  manageOneTimeTasks?: any[];
  tasks?: any[];
  calFeeds?: any[];
};

export async function getBootstrap(viewAs?: string | null): Promise<Bootstrap> {
  const { data, error } = await supabase.rpc("get_bootstrap", {
    view_as: viewAs || null,
  });
  if (error) throw error;
  return data as Bootstrap;
}

export async function toggleChore(choreId: string, viewAs?: string | null) {
  const { data, error } = await supabase.rpc("toggle_chore", {
    chore_id: choreId,
    view_as: viewAs || null,
  });
  if (error) throw error;
  return data as Bootstrap;
}

export async function redeemReward(rewardId: string, viewAs?: string | null) {
  const { data, error } = await supabase.rpc("redeem_reward", {
    reward_id: rewardId,
    view_as: viewAs || null,
  });
  if (error) throw error;
  return data as Bootstrap;
}
