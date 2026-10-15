import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

// The text is split into measured lines, not clipped. Every character remains
// reachable with the text pager, including unusually long paths and identifiers.
export function paginateLines(text: string, width: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(text.replaceAll('\r\n', '\n'))) {
    if (character === '\n') {
      lines.push(line);
      line = '';
    } else if (line && measure(line + character) > width) {
      lines.push(line);
      line = character;
    } else {
      line += character;
    }
  }
  lines.push(line);
  return lines;
}

export function PagedText({ text, label = 'Text', code = false }: { text: string; label?: string; code?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [page, setPage] = useState(0);
  const [metrics, setMetrics] = useState({ width: 240, rows: 2, font: '14px sans-serif' });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const style = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight) || 21;
      const next = {
        width: Math.max(20, (element.clientWidth || 244) - 4),
        rows: Math.max(1, Math.floor((element.clientHeight || 44) / lineHeight)),
        font: style.font || `${style.fontSize || '14px'} ${style.fontFamily || 'sans-serif'}`,
      };
      setMetrics((previous) => previous.width === next.width && previous.rows === next.rows && previous.font === next.font ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [code]);

  const lines = useMemo(() => {
    const canvas = typeof CanvasRenderingContext2D === 'function' ? document.createElement('canvas') : null;
    const context = canvas?.getContext('2d');
    if (context) context.font = metrics.font;
    return paginateLines(text, metrics.width, (value) => context ? context.measureText(value).width : Array.from(value).length * 9);
  }, [text, metrics.width, metrics.font]);
  const pages = Math.max(1, Math.ceil(lines.length / metrics.rows));
  const current = Math.min(page, pages - 1);
  useLayoutEffect(() => setPage(0), [text, metrics.width, metrics.rows]);

  return (
    <div className={code ? 'paged-text code-text' : 'paged-text'}>
      <div ref={ref} className="text-viewport" id={id} aria-label={label}>
        {lines.slice(current * metrics.rows, (current + 1) * metrics.rows).map((line, index) => (
          <span className="text-line" key={index}>{line || '\u00a0'}</span>
        ))}
      </div>
      <div className="text-pagination" aria-label={`${label} text pagination`}>
        <button className="pagination-button" type="button" aria-controls={id} aria-label={`Previous ${label.toLowerCase()} text`} disabled={current === 0} onClick={() => setPage(current - 1)}>←</button>
        <span className="pagination-label" aria-live="polite">{pages > 1 ? `Text ${current + 1} / ${pages}` : 'Full text'}</span>
        <button className="pagination-button" type="button" aria-controls={id} aria-label={`Next ${label.toLowerCase()} text`} disabled={current === pages - 1} onClick={() => setPage(current + 1)}>→</button>
      </div>
    </div>
  );
}

export interface DetailField { label: string; value: string; code?: boolean }

export function DetailPager({ fields, label = 'Detail' }: { fields: DetailField[]; label?: string }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const index = Math.min(selected, Math.max(0, fields.length - 1));
  const field = fields[index];
  if (!field) return <p className="muted">No details were reported.</p>;
  return (
    <div className="detail-pager">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} value={index} onChange={(event) => setSelected(Number(event.target.value))}>
        {fields.map((item, itemIndex) => <option key={`${item.label}-${itemIndex}`} value={itemIndex}>{item.label}</option>)}
      </select>
      <PagedText text={field.value} label={field.label} code={field.code} />
    </div>
  );
}

export function summary(value: string, length = 34): string {
  const characters = Array.from(value);
  return characters.length > length ? `${characters.slice(0, length - 1).join('')}…` : value;
}
