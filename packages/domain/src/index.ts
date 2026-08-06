/** Shared pure domain helpers (mirror of legacy index.html rules). */

export type AppRole = "chore" | "task" | "admin";

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function fmtPts(n: number): string {
  const x = round2(n);
  return x.toFixed(2).replace(/\.?0+$/, "");
}

export function validateRoles(roles: string[]): { ok: boolean; error: string; roles: AppRole[] } {
  const valid: AppRole[] = ["chore", "task", "admin"];
  let next = [...new Set(roles.filter((r): r is AppRole => valid.includes(r as AppRole)))];
  if (!next.length) return { ok: false, error: "Pick at least one role", roles: [] };
  if (next.includes("chore") && next.includes("task")) {
    return { ok: false, error: "Cannot combine Chore + Task", roles: next };
  }
  return { ok: true, error: "", roles: next };
}

export type Chore = { id: string; name: string; pts: number; group?: string | null; group_key?: string | null };

export function groupKey(c: Chore): string | null {
  return c.group_key ?? c.group ?? null;
}

export function isGroupDone(
  group: string,
  chores: Chore[],
  checked: Record<string, boolean>
): boolean {
  const members = chores.filter((c) => groupKey(c) === group);
  return members.length > 0 && members.every((c) => !!checked[c.id]);
}

export function todayEarned(
  chores: Chore[],
  checked: Record<string, boolean>,
  oneTimes: { pts: number; date?: string; due_date?: string; done: boolean }[],
  today: string
): number {
  const solo = chores
    .filter((c) => !groupKey(c) && checked[c.id])
    .reduce((s, c) => s + (c.pts || 0), 0);
  const groups = [...new Set(chores.map(groupKey).filter(Boolean))] as string[];
  const grp = groups
    .filter((g) => isGroupDone(g, chores, checked))
    .reduce(
      (s, g) =>
        s +
        chores.filter((c) => groupKey(c) === g).reduce((a, c) => a + (c.pts || 0), 0),
      0
    );
  const ot = oneTimes
    .filter((t) => (t.due_date || t.date) === today && t.done)
    .reduce((s, t) => s + (t.pts || 0), 0);
  return round2(solo + grp + ot);
}
