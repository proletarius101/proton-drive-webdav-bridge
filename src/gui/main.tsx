import '@mielo-ui/mielo/css/mielo.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { TauriProvider } from './tauri/TauriProvider.js';
import './style.css';

const root = typeof document !== 'undefined' ? document.getElementById('root') : null;

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <TauriProvider>
        <App />
      </TauriProvider>
    </React.StrictMode>
  );
}

// Apply system theme early
const prefersDark =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

if (typeof document !== 'undefined') {
  const body = document.body;
  if (body) {
    body.classList.toggle('dark-theme', !!prefersDark);
    body.classList.toggle('light-theme', !prefersDark);
  }

  // Listen for theme changes
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const b = document?.body;
      if (!b) return;
      b.classList.toggle('dark-theme', !!e.matches);
      b.classList.toggle('light-theme', !e.matches);
    });
  }

  // Error handling
  window.addEventListener('error', (e: any) => {
    console.error('Uncaught error in UI', e.error ?? e.message ?? e);
  });
  window.addEventListener('unhandledrejection', (e: any) => {
    console.error('Unhandled promise rejection in UI', e.reason ?? e);
  });
}
