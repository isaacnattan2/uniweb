import React, { useEffect, useState } from 'react';
import { getMarketplaceCategories } from '../services/api';
import type { MarketplaceCategory } from '../services/api';

export function CategoryOptions({ kind, current }: { kind: MarketplaceCategory['kind']; current: string }) {
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getMarketplaceCategories().then((data) => {
      if (active) setCategories(data.filter((item) => item.kind === kind));
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [kind]);

  return <>
    {failed && !current && <option disabled>Não foi possível carregar categorias</option>}
    {current && !categories.some((category) => category.value === current) && <option value={current}>{current}</option>}
    {categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
  </>;
}
