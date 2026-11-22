const initialPolicy = {
  version: 1,
  baseFare: 3000,
  islandFare: 6000,
  islandPrefixes: ["63"],
  blockedPrefixes: ["00000"],
  cutoff: "15:00",
};
export function shippingPolicy(db) {
  return db.shippingPolicy || initialPolicy;
}
export function zoneForAddress(db, { zip = "", address = "" }) {
  const policy = shippingPolicy(db);
  if (
    !/^\d{5}$/.test(zip) ||
    !address.trim() ||
    /해외|배송 제한/.test(address) ||
    policy.blockedPrefixes.some((prefix) => zip.startsWith(prefix))
  )
    return "blocked";
  return policy.islandPrefixes.some((prefix) => zip.startsWith(prefix)) ||
    /울릉|백령|도서산간/.test(address)
    ? "island"
    : "base";
}
