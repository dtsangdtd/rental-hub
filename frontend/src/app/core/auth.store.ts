import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api';
import { LoginResponse, Role, User } from './models';

const TOKEN_KEY = 'rh.token';
const USER_KEY = 'rh.user';

/** Holds the JWT + current user as signals; persisted in localStorage. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(null);
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => !!this.token() && !!this.user());
  readonly role = computed<Role | null>(() => this.user()?.role ?? null);

  constructor() {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (token && raw && !isExpired(token)) {
      this.token.set(token);
      try {
        this.user.set(JSON.parse(raw) as User);
      } catch {
        this.clear();
      }
    } else {
      this.clear();
    }
  }

  hasRole(...roles: Role[]): boolean {
    const r = this.role();
    return !!r && roles.includes(r);
  }

  async login(email: string, password: string): Promise<User> {
    const res = await this.api.post<LoginResponse>('/auth/login', { email, password });
    this.token.set(res.accessToken);
    this.user.set(res.user);
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    return res.user;
  }

  async register(input: { email: string; password: string; fullName: string; role: 'landlord' | 'tenant' }) {
    await this.api.post<User>('/auth/register', input);
    return this.login(input.email, input.password);
  }

  /** Refresh profile from /auth/me (keeps role/name in sync). */
  async refresh(): Promise<void> {
    if (!this.token()) return;
    const me = await this.api.get<User>('/auth/me');
    this.user.set(me);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
  }

  logout(redirect = true): void {
    this.clear();
    if (redirect) void this.router.navigate(['/login']);
  }

  private clear() {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
