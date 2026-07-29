import Store from 'electron-store';

interface Preferences {
  lastUsername?: string;
}

const store = new Store<Preferences>({ name: 'preferences' });

export function getLastUsername(): string | null {
  return store.get('lastUsername') ?? null;
}

export function setLastUsername(username: string): void {
  store.set('lastUsername', username);
}
