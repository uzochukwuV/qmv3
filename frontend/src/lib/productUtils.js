export const parseJSON = (s, d) => {
  try {
    return JSON.parse(s) || d;
  } catch {
    return d;
  }
};

export const formatPrice = (n, currency) => {
  const sym =
    currency === "NGN" ? "₦" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return sym + Number(n || 0).toLocaleString();
};

export const combinations = (opts) => {
  if (!opts || !opts.length) return [{}];
  return opts.reduce((acc, o) => {
    const result = [];
    acc.forEach((existing) =>
      (o.values || []).forEach((v) => result.push({ ...existing, [o.name]: v }))
    );
    return result;
  }, [{}]);
};

export const variantTotalInventory = (v) =>
  Object.values(v.inventory || {}).reduce((a, b) => a + b, 0);

export const productTotalInventory = (p) => {
  const vs = parseJSON(p.variants, []);
  if (!vs.length) return 0;
  return vs.reduce((sum, v) => sum + variantTotalInventory(v), 0);
};

export const inventoryLevel = (p) => {
  if (!p.track_inventory) return "in_stock";
  const total = productTotalInventory(p);
  const threshold = p.reorder_threshold || 5;
  if (total <= 0) return "out";
  if (total <= threshold) return "low";
  return "in_stock";
};

export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");