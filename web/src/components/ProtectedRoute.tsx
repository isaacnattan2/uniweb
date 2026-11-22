import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore, UserType } from '../context/store';

interface ProtectedRouteProps {
  children: ReactNode;
  roles?: UserType[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { token, userType } = useAuthStore();
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (roles && (!userType || !roles.includes(userType))) {
    return <Navigate to={userType === 'admin' ? '/admin' : userType === 'business' ? '/dashboard' : userType === 'driver' ? '/driver' : '/shop'} replace />;
  }

  return <>{children}</>;
}
