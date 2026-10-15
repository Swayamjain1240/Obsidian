import { useId, type ReactNode } from 'react';

interface PanelTabsProps {
  label: string;
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

export function PanelTabs({ label, tabs, value, onChange, children }: PanelTabsProps) {
  const id = useId();
  return (
    <div className="tabbed-panel">
      <div className="panel-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${id}-${tab.id}`}
            className="panel-tab"
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            aria-controls={`${id}-content`}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              else return;
              event.preventDefault();
              onChange(tabs[next].id);
              document.getElementById(`${id}-${tabs[next].id}`)?.focus();
            }}
          >{tab.label}</button>
        ))}
      </div>
      <div className="tab-content" role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${value}`} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
