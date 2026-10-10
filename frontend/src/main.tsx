import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

function App() {
  return (
    <main>
      <h1>Obsidian</h1>
      <p>Project foundation is being prepared.</p>
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
