import { getHaversineDistance } from './geo';

/** Backend sends 999 km when rider GPS is missing/stale — never show this to drivers. */
const DISPATCH_FALLBACK_DISTANCE_KM = 999;
const MAX_TRUSTED_DISTANCE_KM = 100;
/** Hard client-side gate — matches backend offer radius. */
export const MAX_OFFER_DISTANCE_KM = 40;
const MAX_TRUSTED_ETA_MINS = 500;
const RIDER_SPEED_M_PER_MIN = 416; // ~25 km/h to restaurant

export const PICKUP_METRICS_SOURCE = {
  GPS: 'gps',
  DISPATCH: 'dispatch',
  LOCATING: 'locating',
  OUT_OF_RANGE: 'out_of_range',
};

export function getOrderRestaurantLatLng(order) {
  if (!order) return null;
  const rest = order.restaurantLocation || order.restaurantId?.location || order.restaurant?.location || {};
  const coords = Array.isArray(rest.coordinates)
    ? rest.coordinates
    : (Array.isArray(order.restaurantCoordinates) ? order.restaurantCoordinates : null);

  const lat = parseFloat(
    order.restaurant_lat || order.restaurantLat || rest.latitude || rest.lat || (coords ? coords[1] : NaN),
  );
  const lng = parseFloat(
    order.restaurant_lng || order.restaurantLng || rest.longitude || rest.lng || (coords ? coords[0] : NaN),
  );
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

/** Drop cross-city / absurd offers when rider GPS is known. */
export function isOrderWithinOfferRange(order, riderLocation, maxKm = MAX_OFFER_DISTANCE_KM) {
  if (
    !riderLocation ||
    !Number.isFinite(riderLocation.lat) ||
    !Number.isFinite(riderLocation.lng)
  ) {
    return true;
  }
  const restaurant = getOrderRestaurantLatLng(order);
  if (!restaurant) return true;
  const km =
    getHaversineDistance(
      riderLocation.lat,
      riderLocation.lng,
      restaurant.lat,
      restaurant.lng,
    ) / 1000;
  return Number.isFinite(km) ? km <= maxKm : true;
}

export function isTrustedDispatchDistance(km) {
  const value = Number(km);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (value >= DISPATCH_FALLBACK_DISTANCE_KM || value > MAX_TRUSTED_DISTANCE_KM) {
    return false;
  }
  return true;
}

function isTrustedDispatchEta(mins) {
  const value = Number(mins);
  if (!Number.isFinite(value) || value <= 0) return false;
  return value < MAX_TRUSTED_ETA_MINS;
}

/** Strip sentinel / bogus dispatch values so nothing else in the app can render 999 / 2407. */
export function sanitizeOrderDispatchMetrics(order) {
  if (!order || typeof order !== 'object') return order;

  const next = { ...order };
  if (!isTrustedDispatchDistance(next.pickupDistanceKm)) {
    delete next.pickupDistanceKm;
  }
  if (!isTrustedDispatchDistance(next.distanceKm)) {
    delete next.distanceKm;
  }

  for (const key of ['estimatedTime', 'duration', 'eta']) {
    if (key in next && !isTrustedDispatchEta(next[key])) {
      delete next[key];
    }
  }

  return next;
}

function buildReadyMetrics(source, distanceKm, etaMins) {
  return {
    source,
    isReady: true,
    distanceKm: Number(distanceKm),
    etaMins: Number(etaMins),
  };
}

function buildLocatingMetrics() {
  return {
    source: PICKUP_METRICS_SOURCE.LOCATING,
    isReady: false,
    distanceKm: null,
    etaMins: null,
  };
}

function buildOutOfRangeMetrics(distanceKm) {
  return {
    source: PICKUP_METRICS_SOURCE.OUT_OF_RANGE,
    isReady: false,
    distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm) : null,
    etaMins: null,
  };
}

/**
 * Pickup distance & ETA for delivery-boy new-order cards.
 * 1. Live rider GPS → restaurant (instant, updates when GPS moves)
 * 2. Trusted backend dispatch distance (only real km, never 999)
 * 3. Locating state — no fake km or minutes
 */
export function computePickupMetrics(order, riderLocation) {
  if (!order) return buildLocatingMetrics();

  const prepBuffer = Number(order.prepTime || order.preparationTime || 5);
  const restaurant = getOrderRestaurantLatLng(order);

  if (
    riderLocation &&
    Number.isFinite(riderLocation.lat) &&
    Number.isFinite(riderLocation.lng) &&
    restaurant
  ) {
    const distM = getHaversineDistance(
      riderLocation.lat,
      riderLocation.lng,
      restaurant.lat,
      restaurant.lng,
    );
    const km = distM / 1000;
    if (km > MAX_OFFER_DISTANCE_KM) {
      return buildOutOfRangeMetrics(Number(km.toFixed(1)));
    }
    const mins = Math.max(1, Math.ceil(distM / RIDER_SPEED_M_PER_MIN) + prepBuffer);
    return buildReadyMetrics(PICKUP_METRICS_SOURCE.GPS, Number(km.toFixed(1)), mins);
  }

  const rawDist = order.pickupDistanceKm ?? order.distanceKm;
  const rawEta = order.estimatedTime ?? order.duration ?? order.eta;

  if (isTrustedDispatchDistance(rawDist)) {
    const km = Number(rawDist);
    if (km > MAX_OFFER_DISTANCE_KM) {
      return buildOutOfRangeMetrics(km);
    }
    const mins = isTrustedDispatchEta(rawEta)
      ? Math.ceil(Number(rawEta))
      : Math.max(1, Math.ceil((km * 1000) / RIDER_SPEED_M_PER_MIN) + prepBuffer);
    return buildReadyMetrics(PICKUP_METRICS_SOURCE.DISPATCH, km, mins);
  }

  return buildLocatingMetrics();
}

/** Compact line for order card header, e.g. "2.4 km · 9 min" or "Locating route…" */
export function formatPickupRouteSummary(metrics) {
  if (metrics?.source === PICKUP_METRICS_SOURCE.OUT_OF_RANGE) {
    return 'Outside your area';
  }
  if (!metrics?.isReady) {
    return 'Locating route…';
  }
  const approx = metrics.approximate ? '~' : '';
  return `${approx}${Number(metrics.distanceKm).toFixed(1)} km · ${approx}${metrics.etaMins} min`;
}
