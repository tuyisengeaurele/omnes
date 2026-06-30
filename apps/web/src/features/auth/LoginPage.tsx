import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  useEffect(() => {
    document.title = 'Login | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const { data: logoBase64 } = useQuery({
    queryKey: ['logo'],
    queryFn: async () => {
      const res = await api.get('/public/logo');
      return res.data.data.logo as string;
    },
    staleTime: Infinity,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      await login(data.email, data.password);
      void navigate('/dashboard');
    } catch {
      setError('Invalid email or password. Please try again.');
    }
  };

  return (
    <div className="flex h-screen">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-[40%] flex-col items-center justify-center bg-dark text-white p-12">
        <div className="flex flex-col items-center gap-8 max-w-xs">
          {logoBase64 ? (
            <img src={logoBase64} alt="OMNES Logo" className="h-24 w-24 object-contain rounded-xl shadow-2xl" />
          ) : (
            <div className="h-24 w-24 rounded-xl bg-primary flex items-center justify-center text-3xl font-bold shadow-2xl">O</div>
          )}
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">OMNES ERP</h1>
            <p className="mt-2 text-slate-400 text-sm">Enterprise Resource Planning</p>
          </div>
          <div className="text-center text-slate-400 text-sm leading-relaxed">
            <p>Integrated management for</p>
            <p>brick manufacturing operations.</p>
          </div>
          <div className="flex flex-col gap-2 w-full text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-brand-success" />
              Human Resources & Payroll
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-brand-success" />
              Production & Kiln Management
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-brand-success" />
              Sales, Procurement & Finance
            </div>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8">
            {logoBase64 ? (
              <img src={logoBase64} alt="OMNES" className="h-16 w-16 object-contain rounded-xl" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-primary flex items-center justify-center text-2xl font-bold text-white">O</div>
            )}
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-dark">Sign in to OMNES</h2>
            <p className="mt-1 text-sm text-brand-muted">Use your work email and password to sign in.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@omnes.rw"
                autoComplete="email"
                {...register('email')}
                className={errors.email ? 'border-destructive' : ''}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register('password')}
                  className={errors.password ? 'border-destructive pr-10' : 'pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-brand-muted">
            OMNES ERP &copy; {new Date().getFullYear()}. Authorised access only.
          </p>
        </div>
      </div>
    </div>
  );
}
