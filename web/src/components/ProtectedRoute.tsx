import React, { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, UserType } from '../context/store';

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: UserType[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { token, userType } = useAuthStore();
  const { pathname, search } = useLocation();
  
  if (!token) {
    const from = /^\/(?:business|order)\//.test(pathname) ? pathname + search : undefined;
    return <Navigate to="/login" state={from ? { from } : undefined} replace />;
  }
  if (roles && (!userType || !roles.includes(userType))) {
    return <Navigate to={userType === 'admin' ? '/admin' : userType === 'business' ? '/dashboard' : userType === 'driver' ? '/driver' : '/shop'} replace />;
  }

  return <>{children}</>;
}
