import React, { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { getDeliveryTracking } from '../services/api';
import type { TrackedPosition } from '../services/api';

const key = import.meta.env.VITE_GOOGLE_MAPS_WEB_KEY?.trim();
let mapsLibrary: Promise<google.maps.MapsLibrary> | undefined;

function loadMaps() {
  if (!mapsLibrary) {
    setOptions({ key, language: 'pt-BR', region: 'BR' });
    mapsLibrary = importLibrary('maps');
  }
  return mapsLibrary;
}

function DriverMap({ position }: { position: TrackedPosition }) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<{ map: google.maps.Map; marker: google.maps.Circle }>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!key) return;
    let active = true;
    void loadMaps().then(({ Map, Circle }) => {
      if (!active || !element.current) return;
      const map = new Map(element.current, {
        zoom: 16, mapTypeControl: false, streetViewControl: false, gestureHandling: 'cooperative',
      });
      const marker = new Circle({
        map, radius: 18, fillColor: '#1762d1', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3,
      });
      instance.current = { map, marker };
      setReady(true);
    }).catch(() => { if (active) setError(true); });
    return () => {
      active = false;
      instance.current?.marker.setMap(null);
      instance.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!ready || !instance.current) return;
    const center = { lat: position.latitude, lng: position.longitude };
    instance.current.marker.setCenter(center);
    instance.current.map.setCenter(center);
  }, [position, ready]);

  if (!key || error) return <p role="status">O mapa de acompanhamento está indisponível.</p>;
  return <div ref={element} className="live-delivery-map" role="region" aria-label="Mapa com a localização do entregador" />;
}

export function LiveDelivery({ orderId, panelId }: { orderId: string; panelId: string }) {
  const [position, setPosition] = useState<TrackedPosition | null>(null);
  const [status, setStatus] = useState('Buscando a localização do entregador…');

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await getDeliveryTracking(orderId, controller.signal);
        if (controller.signal.aborted) return;
        setPosition(data.position);
        setStatus(data.active ? 'Aguardando a localização do entregador…' :
          'O acompanhamento fica disponível enquanto a entrega estiver em andamento.');
      } catch {
        if (controller.signal.aborted) return;
        setPosition(null);
        setStatus('Não foi possível atualizar a localização. Tentando novamente…');
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 8000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [orderId]);

  return (
    <section id={panelId} className="live-delivery" aria-label="Entrega em tempo real">
      {position ? <>
        <DriverMap position={position} />
        <p>Última localização às {new Date(position.updatedAt).toLocaleTimeString('pt-BR')}</p>
      </> : <p role="status">{status}</p>}
    </section>
  );
}
