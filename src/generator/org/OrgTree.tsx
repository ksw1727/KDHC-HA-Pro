import { useState } from 'react';
import { Button, TextInput } from '../ui/ui';
import { KDHC_FETCHED_AT, KDHC_TREE, type OrgNode, allBranches, allHqDivisions, isKdhcOrg, searchMatches, searchVisible, selectedDescendants, sortByTree } from './kdhcOrg';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** 한난 조직 트리에서 체크로 제출처 고르기. 상위를 체크해도 하위는 따로 (data/kdhc-org/README.md 선택 규칙) */
export function OrgTree({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const selected = new Set(value);
  const [open, setOpen] = useState<Set<string>>(() => new Set(KDHC_TREE.map((r) => r.id)));
  const [query, setQuery] = useState('');
  const [extra, setExtra] = useState('');
  const visible = searchVisible(query);
  const found = searchMatches(query);
  const allFound = found.length > 0 && found.every((id) => selected.has(id));
  const extras = value.filter((x) => !isKdhcOrg(x));

  const commit = (ids: string[]) => onChange(sortByTree(ids));
  const toggle = (id: string) => commit(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (n: OrgNode) => {
    const kids = n.children.filter((c) => c.selectable).map((c) => c.id);
    const allKids = kids.length > 0 && kids.every((k) => selected.has(k));
    const expanded = visible ? true : open.has(n.id);
    const below = expanded ? 0 : selectedDescendants(n, selected);
    return (
      <li key={n.id} role="treeitem" aria-expanded={n.children.length ? expanded : undefined} aria-selected={n.selectable ? selected.has(n.id) : undefined}>
        <div className="group flex items-center gap-1 rounded py-0.5 pr-1 hover:bg-panel" style={{ paddingLeft: n.level * 14 }}>
          {n.children.length > 0 ? (
            <button type="button" aria-label={`${n.name} ${expanded ? '접기' : '펼치기'}`} onClick={() => toggleOpen(n.id)} disabled={!!visible}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-muted outline-none focus-visible:ring-2 focus-visible:ring-pri-bg">
              {expanded ? '▾' : '▸'}
            </button>
          ) : <span className="w-4 shrink-0" />}
          {n.selectable ? (
            <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
              <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-[var(--color-pri)]" checked={selected.has(n.id)} onChange={() => toggle(n.id)} aria-label={n.id} />
              <span className={cx('truncate', selected.has(n.id) && 'font-semibold text-pri-ink')}>{n.name}</span>
            </label>
          ) : (
            <span className="truncate font-semibold text-sub">{n.name.replace(/^\((.*)\)$/, '$1')}</span>
          )}
          {below > 0 && <span className="shrink-0 rounded-full bg-pri-bg px-1.5 text-[10px] font-semibold text-pri-ink">하위 {below}개 선택됨</span>}
          {kids.length > 1 && (
            <button type="button" onClick={() => commit(allKids ? value.filter((x) => !kids.includes(x)) : [...value, ...kids])}
              className="ml-auto shrink-0 rounded px-1 text-[11px] text-pri opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pri-bg">
              {allKids ? '하위 해제' : `하위 모두(${kids.length})`}
            </button>
          )}
        </div>
        {expanded && n.children.length > 0 && <ul role="group" className="m-0 list-none p-0">{n.children.filter((c) => !visible || visible.has(c.id)).map(row)}</ul>}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => commit([...value, ...allBranches()])}>지사 전체</Button>
        <Button size="sm" onClick={() => commit([...value, ...allHqDivisions()])}>본사 처·실 전체</Button>
        <Button size="sm" variant="ghost" onClick={() => commit([])} disabled={value.length === 0}>선택 해제</Button>
      </div>
      <TextInput type="search" aria-label="조직 검색" placeholder="부서·지사 이름 검색 (예: 인사, 강남, 운영1부)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {found.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-sub">검색된 곳 <b>{found.length}</b>개</span>
          <span className="flex-1" />
          <Button size="sm" variant={allFound ? 'default' : 'pri'} onClick={() => commit(allFound ? value.filter((x) => !found.includes(x)) : [...value, ...found])}>
            {allFound ? '검색된 곳 선택 해제' : `검색된 ${found.length}곳 모두 선택`}
          </Button>
        </div>
      )}
      <ul role="tree" aria-label="한난 조직" aria-multiselectable="true" className="m-0 max-h-72 list-none overflow-auto rounded-btn border border-line p-1 text-[13px]">
        {KDHC_TREE.filter((r) => !visible || visible.has(r.id)).map(row)}
        {visible?.size === 0 && <li className="p-2 text-xs text-muted">"{query}"에 맞는 조직이 없어요</li>}
      </ul>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-sub">트리에 없는 곳 직접 추가</span>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (extra.trim()) commit([...value, extra.trim()]); setExtra(''); }}>
          <TextInput className="flex-1" aria-label="트리에 없는 제출처 이름" placeholder="예: 협력업체 A" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <Button size="sm" type="submit" disabled={!extra.trim()}>추가</Button>
        </form>
        {extras.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {extras.map((x) => (
              <span key={x} className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-xs">
                {x}
                <button type="button" aria-label={`${x} 빼기`} className="text-muted hover:text-err-ink" onClick={() => commit(value.filter((v) => v !== x))}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="m-0 text-[11px] text-muted">조직도 기준일 {KDHC_FETCHED_AT}. 상위를 체크해도 하위는 따로 골라야 해요.</p>
    </div>
  );
}
