import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../../src/lib/i18n';
import { AppShell } from '../../src/app/AppShell';

describe('AppShell', () => {
  it('lists all six modules in the sidebar', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const expectedLabels = [
      'Core',
      'Point of Sale',
      'Inventory',
      'Customers',
      'Reports',
      'Administration',
    ];

    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
