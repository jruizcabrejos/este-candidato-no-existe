const BASE_URL = import.meta.env.BASE_URL || "/";

export const SITE_URL = "https://www.incaslop.online/candidatos/";

export function assetUrl(value) {
  if (!value) {
    return value;
  }

  const url = String(value);
  if (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ||
    url.startsWith("//") ||
    !url.startsWith("/")
  ) {
    return url;
  }

  const base = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
  return `${base}${url.replace(/^\/+/, "")}`;
}

export function appRoutePath(pathname = window.location.pathname) {
  const basePath = new URL(BASE_URL, window.location.origin).pathname.replace(/\/+$/, "");
  let routePath = pathname;

  if (basePath && basePath !== "/" && routePath.startsWith(`${basePath}/`)) {
    routePath = routePath.slice(basePath.length);
  } else if (basePath && basePath !== "/" && routePath === basePath) {
    routePath = "/";
  }

  routePath = routePath.replace(/\/+$/, "") || "/";
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

export function imageProxyUrl(imageUrl) {
  return assetUrl(`/api/image-proxy.php?url=${encodeURIComponent(imageUrl)}`);
}
