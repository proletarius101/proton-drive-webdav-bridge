import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { TauriProvider } from '../../src/gui/tauri/TauriProvider';
import type { TauriApi } from '../../src/gui/tauri/TauriProvider';

export function renderWithTauri(
  container: HTMLElement,
  element: React.ReactElement,
  api: TauriApi
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(TauriProvider, api, element));
  });
  return root;
}
