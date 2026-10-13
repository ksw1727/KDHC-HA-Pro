import data from '../../../data/kdhc-org/kdhc-org.json';

/** 한난 조직 트리 (형식: data/kdhc-org/README.md) */
export interface OrgNode {
  id: string;          // 전체 이름. 제출처 이름으로 그대로 쓴다
  name: string;        // 화면에 보일 짧은 이름
  type: string;
  category: 'hq' | 'branch';
  selectable: boolean; // false = 구분·묶음 (체크박스 없음)
  level: number;
  children: OrgNode[];
}

export const KDHC_FETCHED_AT: string = data.fetchedAt;
export const KDHC_TREE = data.tree as OrgNode[];

const ALL: OrgNode[] = [];
const PARENT = new Map<string, OrgNode>();
(function walk(nodes: OrgNode[], parent?: OrgNode) {
  for (const n of nodes) {
    ALL.push(n);
    if (parent) PARENT.set(n.id, parent);
    walk(n.children, n);
  }
})(KDHC_TREE);
const ORDER = new Map(ALL.map((n, i) => [n.id, i]));
const BY_ID = new Map(ALL.map((n) => [n.id, n]));

export const isKdhcOrg = (id: string) => BY_ID.get(id)?.selectable === true;

/** 트리에 있는 이름은 트리 순서(위→아래)로, 트리에 없는 이름은 뒤에 원래 순서대로 (중복 제거) */
export function sortByTree(ids: string[]): string[] {
  const uniq = [...new Set(ids)];
  const inTree = uniq.filter(isKdhcOrg).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
  return [...inTree, ...uniq.filter((x) => !isKdhcOrg(x))];
}

/** 부르는 말 추천: 고른 곳이 모두 지사·사업소면 '지사', 섞이면 '부서' */
export function recommendLabel(ids: string[]): '지사' | '부서' {
  return ids.every((id) => ['지사', '사업소'].includes(BY_ID.get(id)?.type ?? '')) ? '지사' : '부서';
}

/** 빠른 선택: 지사 전체 (지사·사업소 19곳) */
export const allBranches = () => KDHC_TREE.filter((r) => r.category === 'branch').flatMap((r) => r.children.filter((c) => c.selectable).map((c) => c.id));
/** 빠른 선택: 본사 처·실·센터 전체 */
export const allHqDivisions = () => ALL.filter((n) => n.category === 'hq' && ['처', '실', '센터'].includes(n.type)).map((n) => n.id);

/** 하위(자손) 중 선택된 개수 */
export function selectedDescendants(node: OrgNode, selected: Set<string>): number {
  return node.children.reduce((sum, c) => sum + (selected.has(c.id) ? 1 : 0) + selectedDescendants(c, selected), 0);
}

/** 이름에 검색어가 있으면 맞음. "강남지사 운영1부"처럼 띄어 쓴 전체 이름은 그 조직만 (하위 과까지 딸려오지 않게) */
const matches = (n: OrgNode, q: string) => n.name.toLowerCase().includes(q) || (q.includes(' ') && n.id.toLowerCase().endsWith(q));

/** 검색에 걸린 선택 가능한 조직 id (트리 순서). [검색된 곳 모두 선택]에 쓴다 */
export function searchMatches(query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? ALL.filter((n) => n.selectable && matches(n, q)).map((n) => n.id) : [];
}

/** 검색: name·id 부분 일치하는 노드와 그 조상들의 id. 검색어가 비면 null */
export function searchVisible(query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const out = new Set<string>();
  for (const n of ALL) {
    if (!matches(n, q)) continue;
    for (let p: OrgNode | undefined = n; p && !out.has(p.id); p = PARENT.get(p.id)) out.add(p.id);
  }
  return out;
}
