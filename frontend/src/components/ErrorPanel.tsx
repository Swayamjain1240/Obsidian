import type { ReactNode } from 'react';
import { PagedText } from './PagedText';

export function ErrorPanel({ title = 'Request could not be completed', message, children }: { title?: string; message: string; children?: ReactNode }) {
  return (
    <section className="panel failure-panel" aria-label={title}>
      <h2>{title}</h2>
      <div className="error-content" role="alert"><PagedText text={message} label="Error details" /></div>
      {children ? <div className="panel-actions">{children}</div> : null}
    </section>
  );
}
