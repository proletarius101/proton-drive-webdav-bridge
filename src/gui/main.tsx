import '@mielo-ui/mielo/css/mielo.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './style.css';

const root = typeof document !== 'undefined' ? document.getElementById('root') : null;

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Re-export legacy helpers for tests and incremental migration
export { initGui } from './main.ts';
