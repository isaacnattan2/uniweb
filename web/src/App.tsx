import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { SessionGate } from './components/SessionGate';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { AdminPage } from './pages/AdminPage';
import { BusinessPage } from './pages/BusinessPage';
import { NewBusinessPage } from './pages/NewBusinessPage';
import { NewProductPage } from './pages/NewProductPage';
import { EditProductPage } from './pages/EditProductPage';
import { ShopPage } from './pages/ShopPage';
import { StorePublicPage } from './pages/StorePublicPage';
import { CartPage } from './pages/CartPage';
import { OrdersPage } from './pages/OrdersPage';
import './styles/global.css';

function App() {
  return (
    <SessionGate>
    <Router>
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/shop" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/store/:businessId" element={<StorePublicPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route
          path="/orders"
          element={
            <ProtectedRoute roles={['customer']}>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/order/:orderId"
          element={
            <ProtectedRoute roles={['customer']}>
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['admin']}>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute roles={['business']}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/new-business"
          element={
            <ProtectedRoute roles={['admin']}>
              <NewBusinessPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/business/:businessId"
          element={
            <ProtectedRoute roles={['admin', 'business']}>
              <BusinessPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/business/:businessId/new-product"
          element={
            <ProtectedRoute roles={['admin', 'business']}>
              <NewProductPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/business/:businessId/product/:productId/edit"
          element={
            <ProtectedRoute roles={['admin', 'business']}>
              <EditProductPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
    </SessionGate>
  );
}

export default App;
