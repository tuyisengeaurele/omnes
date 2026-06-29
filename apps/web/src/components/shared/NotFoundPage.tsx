import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-brand-bg gap-4">
      <div className="text-8xl font-bold text-primary">404</div>
      <h1 className="text-2xl font-semibold text-dark">Page not found</h1>
      <p className="text-brand-muted">The page you are looking for does not exist.</p>
      <Button asChild>
        <Link to="/dashboard"><Home className="h-4 w-4" />Go to Dashboard</Link>
      </Button>
    </div>
  );
}
