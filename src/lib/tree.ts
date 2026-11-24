import type { TreeNode } from "./types";

export function childrenMap(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const m = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    const k = n.parent_id;
    m.set(k, [...(m.get(k) ?? []), n]);
  }
  for (const list of m.values()) {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "ko"));
  }
  return m;
}

/** 루트 → id 경로 */
export function pathTo(nodes: TreeNode[], id: string): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: TreeNode[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

export function descendants(nodes: TreeNode[], id: string): Set<string> {
  const m = childrenMap(nodes);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of m.get(cur) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

/** 트리의 루트들: parent가 없거나 parent가 목록에 없는 노드 */
export function roots(nodes: TreeNode[]): TreeNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes
    .filter((n) => !n.parent_id || !ids.has(n.parent_id))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "ko"));
}
