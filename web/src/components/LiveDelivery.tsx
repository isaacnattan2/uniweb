import React, { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'leaflet/dist/leaflet.css';
import { getDeliveryTracking } from '../services/api';
import type { TrackedPosition } from '../services/api';

const mapStyle = import.meta.env.VITE_OSM_MAP_STYLE_URL?.trim() || 'https://tiles.openfreemap.org/styles/liberty';

function DriverMap({ position }: { position: TrackedPosition }) {
  const element = useRef<HTMLDivElement>(null);
  const latestPosition = useRef(position);
  const updatePosition = useRef<(position: TrackedPosition) => void>();
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'vector' | 'raster' | 'unavailable'>('vector');

  useEffect(() => {
    latestPosition.current = position;
    updatePosition.current?.(position);
  }, [position]);

  useEffect(() => {
    const container = element.current;
    if (!container || mode === 'unavailable') return;
    let active = true;
    let loaded = false;
    let dispose: (() => void) | undefined;
    const fail = () => {
      if (!active) return;
      setReady(false);
      setMode(mode === 'vector' ? 'raster' : 'unavailable');
    };
    const timer = window.setTimeout(fail, 8000);
    const markLoaded = () => {
      if (!active || loaded) return;
      loaded = true;
      window.clearTimeout(timer);
      setReady(true);
    };

    if (mode === 'vector') {
      void import('maplibre-gl').then(({ Map, Marker, setWorkerUrl }) => {
        if (!active) return;
        setWorkerUrl(workerUrl);
        const { longitude, latitude } = latestPosition.current;
        const map = new Map({
          container, style: mapStyle, center: [longitude, latitude], zoom: 16, cooperativeGestures: true,
        });
        dispose = () => map.remove();
        const marker = new Marker({ color: '#1762d1' }).setLngLat([longitude, latitude]).addTo(map);
        updatePosition.current = ({ longitude, latitude }) => {
          marker.setLngLat([longitude, latitude]);
          map.setCenter([longitude, latitude]);
        };
        map.once('load', markLoaded);
        map.on('error', () => { if (!loaded) fail(); });
        map.on('webglcontextlost', fail);
      }).catch(fail);
    } else {
      void import('leaflet').then(({ map, tileLayer, circleMarker }) => {
        if (!active) return;
        const { longitude, latitude } = latestPosition.current;
        const rasterMap = map(container, { scrollWheelZoom: false });
        dispose = () => rasterMap.remove();
        rasterMap.setView([latitude, longitude], 16);
        const tiles = tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        });
        tiles.once('tileload', markLoaded);
        tiles.addTo(rasterMap);
        const marker = circleMarker([latitude, longitude], {
          radius: 9, color: '#fff', weight: 3, fillColor: '#1762d1', fillOpacity: 1,
        }).addTo(rasterMap);
        updatePosition.current = ({ longitude, latitude }) => {
          marker.setLatLng([latitude, longitude]);
          rasterMap.panTo([latitude, longitude], { animate: false });
        };
      }).catch(fail);
    }

    return () => {
      active = false;
      window.clearTimeout(timer);
      updatePosition.current = undefined;
      dispose?.();
    };
  }, [mode]);

  return <>
    {mode !== 'unavailable' && <div ref={element} className="live-delivery-map" role="region"
      aria-label="Mapa com a localização do entregador" aria-busy={!ready} />}
    {!ready && <p role="status">
      {mode === 'unavailable' ? 'O mapa de acompanhamento está indisponível.' : 'Carregando mapa…'}
    </p>}
  </>;
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
