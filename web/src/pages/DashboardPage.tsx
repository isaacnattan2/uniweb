import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyBusinesses } from '../services/api';
import { useAuthStore, useBusinessStore } from '../context/store';
import '../styles/dashboard.css';

export function DashboardPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.userId);
  const businesses = useBusinessStore((state) => state.businesses);
  const setBusinesses = useBusinessStore((state) => state.setBusinesses);
  const setBusiness = useAuthStore((state) => state.setBusiness);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      navigate('/login');
      return;
    }

    async function loadBusinesses() {
      try {
        const data = await getMyBusinesses();
        setBusinesses(data);
      } catch (error) {
        console.error('Failed to load businesses:', error);
        setError('Não foi possível carregar suas lojas.');
      } finally {
        setLoading(false);
      }
    }

    loadBusinesses();
  }, [userId, navigate, setBusinesses]);

  function handleSelectBusiness(businessId: string) {
    setBusiness(businessId);
    navigate(`/business/${businessId}`);
  }

  return (
    <div className="dashboard">
      <div className="container">
        <div className="page-heading">
          <h1>Minhas Lojas</h1>
        </div>
        {error && <p role="alert">{error}</p>}
        
        {loading ? (
          <p>Carregando...</p>
        ) : error ? null : businesses.length === 0 ? (
          <div className="empty-state">
            <p>Você ainda não possui uma loja vinculada. Entre em contato com o administrador.</p>
          </div>
        ) : (
          <div className="business-grid card-grid card-grid-4">
            {businesses.map((business) => (
              <div key={business.id} className="business-card card-layout">
                <h3 className="card-row-1">{business.name}</h3>
                <p className="category card-row-2">{business.category}</p>
                <p className="description card-row-3">{business.description}</p>
                <div className="card-actions card-footer card-row-4">
                  <button
                    onClick={() => handleSelectBusiness(business.id)}
                    className="btn-primary"
                  >
                    Gerenciar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
