import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './LoginPage';

const mockLogin = vi.fn();

// Mock the auth context — mockLogin is a stable ref so we can change it per test
vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    user: null,
    isLoading: false,
  }),
}));

// Mock navigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// Mock axios to prevent real network calls (logo fetch)
vi.mock('@/lib/axios', () => ({
  api: {
    get: vi.fn().mockRejectedValue(new Error('no network in tests')),
  },
}));

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
  });

  it('renders email and password fields', () => {
    renderLoginPage();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders a Sign In button', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows validation error when email is empty and form is submitted', async () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      expect(screen.getByText('Invalid email address')).toBeInTheDocument();
    });
  });

  it('shows validation error when password is empty', async () => {
    renderLoginPage();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'admin@omnes.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      expect(screen.getByText('Password is required')).toBeInTheDocument();
    });
  });

  it('shows login error message when credentials are rejected', async () => {
    mockLogin.mockRejectedValue(new Error('Unauthorized'));
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'wrong@omnes.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Invalid email or password. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('renders OMNES ERP heading on the brand panel', () => {
    renderLoginPage();
    expect(screen.getByText('OMNES ERP')).toBeInTheDocument();
  });

  it('renders Sign in to OMNES heading on the form panel', () => {
    renderLoginPage();
    expect(screen.getByText('Sign in to OMNES')).toBeInTheDocument();
  });
});
