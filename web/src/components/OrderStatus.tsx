const labels: Record<string, string> = {
  pending: 'Pendente', confirmed: 'Confirmado', processing: 'Processando',
  completed: 'Concluído', cancelled: 'Cancelado',
  delivery_in_progress: 'Entrega em andamento', delivery_completed: 'Entrega realizada',
  delivery_driver_cancelled: 'Entrega cancelada pelo entregador',
};

export function OrderStatus({ order }: { order: {
  status: string; delivery_type: string; delivery_status: string | null; delivery_assigned: boolean;
} }) {
  let status = order.status;
  if (order.delivery_type === 'delivery' && status !== 'cancelled') {
    if (order.delivery_status === 'delivered') status = 'delivery_completed';
    else if (order.delivery_status === 'cancelled' && order.delivery_assigned) status = 'delivery_driver_cancelled';
    else if (order.delivery_status === 'processing' || order.delivery_status === 'in_transit') status = 'delivery_in_progress';
  }
  return <span className={`order-status status-${status}`}>{labels[status] || status}</span>;
}
