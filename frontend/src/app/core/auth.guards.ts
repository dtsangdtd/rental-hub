import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE } from './api';
import { AuthStore } from './auth.store';
import { Role } from './models';

/** Attach the bearer token; on 401 (expired/invalid token) log out. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const token = auth.token();
  const isApi = req.url.startsWith(API_BASE);
  const authReq = token && isApi ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authReq).pipe(
    catchError((err: unknown) => {
      const isLogin = req.url.endsWith('/auth/login');
      if (err instanceof HttpErrorResponse && err.status === 401 && token && !isLogin) auth.logout();
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = () =>
  inject(AuthStore).isLoggedIn() ? inject(Router).createUrlTree(['/dashboard']) : true;

/** Route-level role check (data: { roles: Role[] }). The backend still enforces it — this is UX only. */
export const roleGuard: CanActivateFn = (route) => {
  const roles = (route.data['roles'] as Role[] | undefined) ?? [];
  const auth = inject(AuthStore);
  return roles.length === 0 || auth.hasRole(...roles) ? true : inject(Router).createUrlTree(['/dashboard']);
};
